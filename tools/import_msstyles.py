#!/usr/bin/env python3
"""Extract the frame resources needed by the Electron XP window from msstyles."""
from __future__ import annotations

import configparser
import io
import json
import struct
import sys
from pathlib import Path

import pefile
from PIL import Image


def resolve_theme(source: Path) -> Path:
    if source.suffix.lower() == '.msstyles':
        return source
    ini = configparser.ConfigParser(interpolation=None, strict=False)
    ini.read(source, encoding='latin-1')
    filename = Path(ini.get('VisualStyles', 'Path', fallback='').replace('\\', '/')).name
    candidates = list(source.parent.rglob(filename)) if filename else []
    candidates += list(source.parent.rglob('*.msstyles'))
    if not candidates:
        raise FileNotFoundError('The .theme file has no nearby .msstyles file')
    # The name in [VisualStyles] is authoritative.  Some bundles ship both
    # aero.msstyles and aerolite.msstyles next to one another.
    if filename:
        for candidate in candidates:
            if candidate.name.lower() == filename.lower():
                return candidate
    return candidates[0]


def decode_dib(data: bytes, preserve_alpha: bool = False) -> Image.Image:
    header_size = struct.unpack_from('<I', data, 0)[0]
    width, raw_height = struct.unpack_from('<ii', data, 4)
    bpp = struct.unpack_from('<H', data, 14)[0]
    colours = struct.unpack_from('<I', data, 32)[0] or ((1 << bpp) if bpp <= 8 else 0)
    offset = 14 + header_size + colours * 4
    # Pillow drops the fourth byte from 32-bit DIBs here.  In msstyles that
    # byte is the real alpha channel of glyphs (including the close X).
    if preserve_alpha and bpp == 32 and width > 0 and raw_height:
        height = abs(raw_height)
        stride = width * 4
        pixel_offset = header_size + colours * 4
        pixels = data[pixel_offset:pixel_offset + stride * height]
        image = Image.frombytes('RGBA', (width, height), pixels, 'raw', 'BGRA', stride, -1 if raw_height > 0 else 1)
    else:
        bmp = b'BM' + struct.pack('<IHHI', 14 + len(data), 0, 0, offset) + data
        image = Image.open(io.BytesIO(bmp)).convert('RGBA')
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if r > 245 and g < 12 and b > 245:
                pixels[x, y] = (r, g, b, 0)
    return image


def bitmaps(msstyles: Path) -> dict[str, Image.Image]:
    pe = pefile.PE(str(msstyles))
    root = next(entry for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries if not entry.name and entry.struct.Id == 2)
    result: dict[str, Image.Image] = {}
    for entry in root.directory.entries:
        name = entry.name.string.decode('utf-8', 'replace') if entry.name else str(entry.struct.Id)
        data = entry.directory.entries[0].data.struct
        try:
            result[name] = decode_dib(pe.get_data(data.OffsetToData, data.Size), name.upper().endswith('GLYPH_BMP'))
        except (OSError, ValueError, struct.error):
            pass
    return result


def image_png(msstyles: Path, image_id: int) -> bytes | None:
    """Read a native PNG from a Vista/Windows 7 msstyles IMAGE resource."""
    pe = pefile.PE(str(msstyles))
    try:
        root = next(entry for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries
                    if entry.name and entry.name.string == b'IMAGE')
        item = next(entry for entry in root.directory.entries if entry.struct.Id == image_id)
        node = item.directory.entries[0]
        if hasattr(node, 'directory'):
            node = node.directory.entries[0]
        data = node.data.struct
        raw = pe.get_data(data.OffsetToData, data.Size)
        return raw if raw.startswith(b'\x89PNG\r\n\x1a\n') else None
    except (AttributeError, StopIteration):
        return None


def stream_png(msstyles: Path, stream_id: int) -> bytes | None:
    """Read a PNG atlas from a Vista/Windows 7 msstyles STREAM resource."""
    pe = pefile.PE(str(msstyles))
    try:
        root = next(entry for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries
                    if entry.name and entry.name.string == b'STREAM')
        item = next(entry for entry in root.directory.entries if entry.struct.Id == stream_id)
        node = item.directory.entries[0]
        if hasattr(node, 'directory'):
            node = node.directory.entries[0]
        data = node.data.struct
        raw = pe.get_data(data.OffsetToData, data.Size)
        return raw if raw.startswith(b'\x89PNG\r\n\x1a\n') else None
    except (AttributeError, StopIteration):
        return None


def save_aero_caption_slices(output: Path, msstyles: Path) -> None:
    """Export the active Windows 7 caption's three real nine-slice pieces."""
    raw = image_png(msstyles, 934)  # Window/CAPTION (Normal DPI)
    if not raw:
        return
    image = Image.open(io.BytesIO(raw)).convert('RGBA')
    active_height = image.height // 2
    active = image.crop((0, 0, image.width, active_height))
    left = min(16, active.width // 3)
    right = min(16, active.width // 3)
    save(active.crop((0, 0, left, active_height)), output, 'aero-title-left.png')
    save(active.crop((left, 0, active.width - right, active_height)), output, 'aero-title-fill.png')
    save(active.crop((active.width - right, 0, active.width, active_height)), output, 'aero-title-right.png')


def save_aero_reflection_map(output: Path, msstyles: Path) -> None:
    """Extract DWMWindow/REFLECTIONMAP from the original Windows 7 atlas."""
    raw = stream_png(msstyles, 971)
    if not raw:
        return
    atlas = Image.open(io.BytesIO(raw)).convert('RGBA')
    # DWMWindow part 40, ATLASRECT = (555, 0, 1357, 604).
    atlas.crop((555, 0, 1357, 604)).save(output / 'aero-glass-reflection.png')


def find(images: dict[str, Image.Image], suffix: str, prefix: str = '') -> Image.Image:
    matches = [image for name, image in images.items()
               if name.upper().endswith(suffix) and (not prefix or name.upper().startswith(prefix.upper() + '_'))]
    if not matches:
        raise KeyError(f'Missing theme resource {suffix}')
    return matches[0]


def save(image: Image.Image, output: Path, name: str) -> None:
    image.save(output / name, 'PNG')


def state(image: Image.Image, index: int) -> Image.Image:
    # Caption button bitmaps are normally vertical state strips.
    side = image.width
    rows = max(1, image.height // side)
    top = min(index, rows - 1) * side
    return image.crop((0, top, image.width, min(top + side, image.height)))


def button_state(image: Image.Image, index: int) -> Image.Image:
    # BUTTON_BMP has five 23px-high states (20x115), unlike caption buttons.
    frame_height = image.height // 5 if image.height % 5 == 0 else image.width
    top = min(index, max(0, image.height // frame_height - 1)) * frame_height
    return image.crop((0, top, image.width, top + frame_height))


def theme_colours(source: Path) -> dict[str, str]:
    defaults = {'Window': '#ece9d8', 'ButtonFace': '#d4d0c8', 'WindowText': '#000000', 'Hilight': '#316ac5'}
    if source.suffix.lower() != '.theme':
        return defaults
    ini = configparser.ConfigParser(interpolation=None, strict=False)
    ini.read(source, encoding='latin-1')
    section = 'Control Panel\\Colors'
    if not ini.has_section(section):
        return defaults
    for key in defaults:
        value = ini.get(section, key, fallback='').replace(',', ' ').split()
        if len(value) == 3 and all(part.isdigit() for part in value):
            defaults[key] = '#%02x%02x%02x' % tuple(int(part) for part in value)
    return defaults


def theme_schemes(source: Path) -> list[dict[str, str]]:
    if source.suffix.lower() != '.theme':
        return [{'id': 'default', 'name': 'Default'}]
    ini = configparser.ConfigParser(interpolation=None, strict=False)
    ini.read(source, encoding='latin-1')
    style = ini.get('VisualStyles', 'ColorStyle', fallback='NormalColor')
    labels = {'NormalColor': 'Default (blue)', 'HomeStead': 'Homestead (green)', 'Metallic': 'Metallic (silver)'}
    return [{'id': style, 'name': labels.get(style, style)}]


def theme_display_name(source: Path, msstyles: Path) -> str:
    """Use the author-provided name from the .theme file when it exists."""
    if source.suffix.lower() == '.theme':
        ini = configparser.ConfigParser(interpolation=None, strict=False)
        ini.read(source, encoding='latin-1')
        value = ini.get('Theme', 'DisplayName', fallback='').strip()
        # @dll,-id is a Windows resource reference. Without that DLL it cannot
        # be resolved; use the actual style's stem rather than showing a path.
        if value and not value.startswith('@'):
            return value
    known_names = {'aero': 'Aero', 'aerolite': 'Aero Lite'}
    stem = source.stem if source.suffix.lower() == '.theme' else msstyles.stem
    return known_names.get(stem.lower(), stem)


def is_aero_style(source: Path, msstyles: Path) -> bool:
    """Aero's Windows 7 resource table is not the XP bitmap table.

    It stores IMAGE/STREAM/PVL resources instead of RT_BITMAP sprites.  The
    application renderer has a native CSS representation for that format.
    """
    return source.stem.lower() in {'aero', 'aerolite'} or msstyles.stem.lower() in {'aero', 'aerolite'}


def write_aero_scheme(output: Path, msstyles: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    # Normal-DPI original Windows 7 Aero resources.  936 is the close-button
    # state strip and 937 is its matching glyph strip.
    for filename, resource_id in [('aero-close-strip.png', 936), ('aero-close-glyphs.png', 937)]:
        raw = image_png(msstyles, resource_id)
        if raw:
            (output / filename).write_bytes(raw)
    save_aero_caption_slices(output, msstyles)
    save_aero_reflection_map(output, msstyles)
    asset = output.resolve().as_uri()
    # This is deliberately CSS rather than a fallback to XP assets: Aero's
    # glass frame is scalable and stays sharp on resizable Electron windows.
    css = '''/* Windows 7 Aero Glass renderer generated for Aero.msstyles. */
:root {
  font-family: "Segoe UI", Tahoma, sans-serif;
  --aero-glass: rgba(116, 184, 252, .42); --aero-glass-dark: rgba(29, 73, 112, .58);
  --xp-caption-height: 29px; --xp-caption-left: 16px; --xp-caption-right: 16px;
  --xp-caption-middle: 1px; --xp-bottom-height: 1px; --xp-bottom-left: 0px;
  --xp-bottom-right: 0px; --xp-bottom-middle: 1px; --xp-controls-width: 88px;
  --xp-control-width: 28px; --xp-control-height: 17px; --xp-control-gap: 2px;
  --xp-theme-window: #f9fbfd; --xp-theme-buttonface: #e8f1fa;
  --xp-theme-windowtext: #1d1d1d; --xp-theme-highlight: #5a9bd5;
  --xp-title-fill: url("{asset}/aero-title-fill.png");
  --xp-title-left: url("{asset}/aero-title-left.png"); --xp-title-right: url("{asset}/aero-title-right.png"); --xp-frame-left: linear-gradient(#7299bd,#31587d);
  --xp-frame-right: linear-gradient(#7299bd,#31587d); --xp-bottom-fill: #31587d;
  --xp-bottom-left-image: none; --xp-bottom-right-image: none;
  --xp-caption-normal: linear-gradient(to bottom, rgba(235,249,255,.78), rgba(91,146,192,.68));
  --xp-caption-hover: linear-gradient(to bottom, #eaf8ff, #75b9ee); --xp-caption-pressed: #4d87bc;
  --xp-close-normal: url("{asset}/aero-close-strip.png"); --xp-close-hover: url("{asset}/aero-close-strip.png"); --xp-close-pressed: url("{asset}/aero-close-strip.png");
  --xp-close-glyph: url("{asset}/aero-close-glyphs.png"); --xp-close-glyph-hover: url("{asset}/aero-close-glyphs.png"); --xp-close-glyph-pressed: url("{asset}/aero-close-glyphs.png");
  --xp-button-border: 1px solid #7195b7; --xp-button-frame: none; --xp-button-frame-hover: none; --xp-button-frame-pressed: none;
  --xp-button-background: linear-gradient(#ffffff,#e8f2fa); --xp-button-background-hover: linear-gradient(#ffffff,#c7e7fb); --xp-button-background-pressed: linear-gradient(#b9d8ed,#eff8ff);
  --xp-button-shadow: inset 0 0 0 1px rgba(255,255,255,.82); --xp-button-shadow-hover: inset 0 0 0 1px rgba(255,255,255,.92); --xp-button-shadow-pressed: inset 0 1px 2px rgba(45,87,120,.45);
}
.xp-window { border: 0; border-radius: 0; background: transparent; box-shadow: 0 0 12px rgba(31,108,181,.78), 0 5px 15px rgba(0,0,0,.38); }
.xp-titlebar { padding: 6px 8px; border-radius: 7px 7px 0 0; border-bottom: 0; font: 600 12px/15px 'Segoe UI', Tahoma, sans-serif; text-shadow: 0 1px 1px #173d63; background-color: var(--aero-glass-dark); background-image: url("{asset}/aero-glass-reflection.png"), var(--xp-title-fill); background-size: 390px 294px, 34px 29px; background-position: center 42%, left top; background-repeat: no-repeat, repeat-x; background-blend-mode: screen, normal; -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); }
.xp-titlebar::before,.xp-titlebar::after { display: block; z-index: 2; background-size: 16px 29px; }
.xp-window-controls { top: 0; right: 5px; }.xp-window-controls button { border: 0; border-radius: 0 0 4px 4px; box-shadow: none; }
.xp-window-controls button::after { width: auto; height: auto; margin: 0; background: none !important; color: #fff; font: 400 16px/18px "Segoe UI Symbol", Arial, sans-serif; text-shadow: 0 1px #174e87; }
#minimize::after { content: '−'; } #maximize::after { content: '□'; font-size: 13px; } #close::after { content: ''; width: 13px; height: 13px; margin: 3px auto 0; background: var(--xp-close-glyph) center top/13px 104px no-repeat !important; }
#close:hover::after { background-position: center -13px !important; } #close:active::after { background-position: center -26px !important; }
#close { background-size: 28px 136px !important; background-position: center top; }
.xp-dialog .dialog-close { border: 1px solid rgba(31,78,121,.82); border-top-color: rgba(255,255,255,.8); border-radius: 0 0 4px 4px; background-size: 28px 136px; background-position: center top; box-shadow: inset 0 0 0 1px rgba(220,244,255,.35); }
.xp-dialog .dialog-close::after { width: 13px; height: 13px; top: 3px; left: 7px; background: var(--xp-close-glyph) center top/13px 104px no-repeat !important; content: ''; }
.xp-dialog .dialog-close:hover::after { background-position: center -13px !important; }.xp-dialog .dialog-close:active::after { background-position: center -26px !important; }
.xp-side { width: 4px; background: var(--aero-glass); -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); }.xp-bottom { height: 4px; background: var(--aero-glass); -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); }.xp-bottom::before,.xp-bottom::after { display:none; }
.chat-app button,.settings-window button,.profile-window button,.call-window button { border: 1px solid #7f9db9; border-radius: 3px; background: linear-gradient(#fff,#e7eef7); box-shadow: inset 0 0 0 1px #fff; } .chat-app button:hover,.settings-window button:hover,.profile-window button:hover,.call-window button:hover { border-color: #3c7fb1; background: linear-gradient(#fafdff,#cfe9fc); }
input,select,textarea { border-color: #9db4cb !important; border-radius: 2px; }.sidebar { background: linear-gradient(90deg,#eef5fc,#dce9f5); border-color:#8ba9c4; }.account-card,.tabs,.sidebar-actions,.composer { background: linear-gradient(#f5f9fd,#dfeaf5); border-color:#a9bed1; }.chat-list,.conversation,.messages { background:#f9fbfd; }.chat-item.active,.tab.active,.conversation-header,.dialog-title { background: linear-gradient(#d9efff,#85b8e1 47%,#5d97ca 51%,#78add7) !important; color:#123f68; text-shadow:0 1px #e8f7ff; }.chat-item.active small,.conversation-header small { color:#244f75; }.search,.composer input { background:#fff; border-color:#9db4cb; }.message { border-color:#b4c7d8; border-radius:3px; box-shadow:0 1px 1px rgba(0,0,0,.08); }.message.mine { background:#e8f4ff; }
.preview-window { border: 1px solid rgba(20,51,82,.86); border-radius: 7px 7px 0 0; box-shadow: inset 0 0 0 1px rgba(236,250,255,.8), 0 2px 6px rgba(20,64,104,.7); background:rgba(249,251,253,.93); }
.preview-window header { height:29px; padding:6px 88px 4px 8px; border-radius:7px 7px 0 0; border-bottom:0; background-color:rgba(55,116,174,.66); background-image:url("{asset}/aero-glass-reflection.png"),url("{asset}/aero-title-fill.png"); background-size:250px 188px,34px 29px; background-position:center 45%,left top; background-repeat:no-repeat,repeat-x; background-blend-mode:screen,normal; -webkit-backdrop-filter:blur(12px) saturate(160%); backdrop-filter:blur(12px) saturate(160%); font-family:'Segoe UI',Tahoma,sans-serif; text-shadow:0 1px #173d63; }
.preview-window .controls { top:4px; right:5px; height:22px; gap:2px; }.preview-window .controls i { width:28px; height:22px; border:1px solid rgba(31,78,121,.82); border-top-color:rgba(255,255,255,.8); border-radius:0 0 4px 4px; background:linear-gradient(to bottom,rgba(235,249,255,.78),rgba(91,146,192,.68)); box-shadow:inset 0 0 0 1px rgba(220,244,255,.35); }.preview-window .controls .close { background-image:url("{asset}/aero-close-strip.png")!important; background-size:28px 136px; background-position:center top; }.preview-window .controls i img { display:none; }.preview-window .controls .min::after,.preview-window .controls .max::after { display:block; color:#fff; text-align:center; font:400 16px/18px 'Segoe UI Symbol',Arial,sans-serif; text-shadow:0 1px #174e87; }.preview-window .controls .min::after{content:'−';}.preview-window .controls .max::after{content:'□';font-size:13px;}.preview-window .controls .close::after{content:'';display:block;width:13px;height:13px;margin:3px auto 0;background:url("{asset}/aero-close-glyphs.png") center top/13px 104px no-repeat;}
'''.replace('{asset}', asset)
    (output / 'theme.css').write_text(css, encoding='utf-8')


def resource_schemes(images: dict[str, Image.Image]) -> list[str]:
    suffix = '_FRAMECAPTION_BMP'
    return [name[:-len(suffix)] for name in images if name.upper().endswith(suffix)]


def scheme_label(prefix: str) -> str:
    labels = {
        'BLUE': 'Default (blue)', 'HOMESTEAD': 'Homestead (green)',
        'METALLIC': 'Metallic (silver)', 'DEFAULT': 'Default', 'ROYALE': 'Royale',
    }
    return labels.get(prefix.upper(), prefix.replace('_', ' ').title())


def source_scheme(source: Path, prefixes: list[str]) -> str:
    if source.suffix.lower() == '.theme':
        ini = configparser.ConfigParser(interpolation=None, strict=False)
        ini.read(source, encoding='latin-1')
        requested = ini.get('VisualStyles', 'ColorStyle', fallback='NormalColor').upper()
        aliases = {'NORMALCOLOR': 'BLUE', 'HOMESTEAD': 'HOMESTEAD', 'METALLIC': 'METALLIC'}
        requested = aliases.get(requested, requested)
        if requested in prefixes:
            return requested
    return prefixes[0]


def write_scheme(output: Path, images: dict[str, Image.Image], prefix: str, colours: dict[str, str], asset: str) -> None:
    output.mkdir(parents=True, exist_ok=True)
    caption = find(images, '_FRAMECAPTION_BMP', prefix)
    cap_height = caption.height // 2
    caption = caption.crop((0, 0, caption.width, cap_height))
    left, right = 28, 35
    if caption.width <= left + right:
        left, right = max(1, caption.width // 4), max(1, caption.width // 4)
    save(caption.crop((0, 0, left, cap_height)), output, 'title-left.png')
    save(caption.crop((left, 0, caption.width - right, cap_height)), output, 'title-fill.png')
    save(caption.crop((caption.width - right, 0, caption.width, cap_height)), output, 'title-right.png')
    save(find(images, '_FRAMELEFT_BMP', prefix), output, 'frame-left.png')
    save(find(images, '_FRAMERIGHT_BMP', prefix), output, 'frame-right.png')
    bottom = find(images, '_FRAMEBOTTOM_BMP', prefix)
    bleft, bright = min(5, bottom.width // 3), min(5, bottom.width // 3)
    save(bottom.crop((0, 0, bleft, bottom.height)), output, 'bottom-left.png')
    save(bottom.crop((bleft, 0, bottom.width - bright, bottom.height)), output, 'bottom-fill.png')
    save(bottom.crop((bottom.width - bright, 0, bottom.width, bottom.height)), output, 'bottom-right.png')
    for name, resource in [('caption', '_CAPTIONBUTTON_BMP'), ('close', '_CLOSEBUTTON_BMP')]:
        button = find(images, resource, prefix)
        for index, state_name in enumerate(('normal', 'hover', 'pressed')):
            save(state(button, index), output, f'{name}-{state_name}.png')
    button = find(images, '_BUTTON_BMP', prefix)
    for index, state_name in enumerate(('normal', 'hover', 'pressed')):
        save(button_state(button, index), output, f'button-{state_name}.png')
    for name, resource in [('minimize', '_MINIMIZEGLYPH_BMP'), ('maximize', '_MAXIMIZEGLYPH_BMP'), ('close', '_CLOSEGLYPH_BMP')]:
        glyph = find(images, resource, prefix)
        for index, state_name in enumerate(('normal', 'hover', 'pressed')):
            save(state(glyph, index), output, f'{name}-glyph-{state_name}.png')
    (output / 'theme.css').write_text(
        ':root { --xp-caption-left: %dpx; --xp-caption-right: %dpx; --xp-caption-middle: 1px; --xp-caption-height: %dpx; --xp-bottom-left: %dpx; --xp-bottom-right: %dpx; --xp-bottom-middle: 1px; --xp-bottom-height: %dpx; --xp-theme-window: %s; --xp-theme-buttonface: %s; --xp-theme-windowtext: %s; --xp-theme-highlight: %s; --xp-title-fill: url("%s/title-fill.png"); --xp-title-left: url("%s/title-left.png"); --xp-title-right: url("%s/title-right.png"); --xp-frame-left: url("%s/frame-left.png"); --xp-frame-right: url("%s/frame-right.png"); --xp-bottom-fill: url("%s/bottom-fill.png"); --xp-bottom-left-image: url("%s/bottom-left.png"); --xp-bottom-right-image: url("%s/bottom-right.png"); --xp-caption-normal: url("%s/caption-normal.png"); --xp-caption-hover: url("%s/caption-hover.png"); --xp-caption-pressed: url("%s/caption-pressed.png"); --xp-close-normal: url("%s/close-normal.png"); --xp-close-hover: url("%s/close-hover.png"); --xp-close-pressed: url("%s/close-pressed.png"); --xp-close-glyph: url("%s/close-glyph-normal.png"); --xp-close-glyph-hover: url("%s/close-glyph-hover.png"); --xp-close-glyph-pressed: url("%s/close-glyph-pressed.png"); --xp-minimize-glyph: url("%s/minimize-glyph-normal.png"); --xp-minimize-glyph-hover: url("%s/minimize-glyph-hover.png"); --xp-minimize-glyph-pressed: url("%s/minimize-glyph-pressed.png"); --xp-maximize-glyph: url("%s/maximize-glyph-normal.png"); --xp-maximize-glyph-hover: url("%s/maximize-glyph-hover.png"); --xp-maximize-glyph-pressed: url("%s/maximize-glyph-pressed.png"); --xp-button-normal: url("%s/button-normal.png"); --xp-button-hover: url("%s/button-hover.png"); --xp-button-pressed: url("%s/button-pressed.png"); }\n'
        % (left, right, cap_height, bleft, bright, bottom.height, colours['Window'], colours['ButtonFace'], colours['WindowText'], colours['Hilight'], *(asset,) * 26), encoding='utf-8')


def import_theme(source: Path, output: Path) -> None:
    msstyles = resolve_theme(source)
    if is_aero_style(source, msstyles):
        scheme = 'normalcolor'
        write_aero_scheme(output, msstyles)
        write_aero_scheme(output / 'schemes' / scheme, msstyles)
        (output / 'theme.json').write_text(json.dumps({
            'theme': theme_display_name(source, msstyles), 'msstyles': msstyles.name,
            'schemes': [{'id': scheme, 'name': 'Default (blue)'}], 'defaultScheme': scheme,
        }, indent=2), encoding='utf-8')
        return
    images = bitmaps(msstyles)
    output.mkdir(parents=True, exist_ok=True)
    colours = theme_colours(source)
    prefixes = resource_schemes(images)
    if not prefixes:
        raise KeyError('Theme has no frame resources')
    selected = source_scheme(source, prefixes)
    write_scheme(output, images, selected, colours, output.resolve().as_uri())
    schemes = []
    for prefix in prefixes:
        scheme_id = prefix.lower()
        schemes.append({'id': scheme_id, 'name': scheme_label(prefix)})
        scheme_output = output / 'schemes' / scheme_id
        write_scheme(scheme_output, images, prefix, colours, scheme_output.resolve().as_uri())
    (output / 'theme.json').write_text(json.dumps({'theme': theme_display_name(source, msstyles), 'msstyles': msstyles.name, 'schemes': schemes, 'defaultScheme': selected.lower()}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: import_msstyles.py THEME_FILE OUTPUT_DIRECTORY')
    import_theme(Path(sys.argv[1]), Path(sys.argv[2]))
