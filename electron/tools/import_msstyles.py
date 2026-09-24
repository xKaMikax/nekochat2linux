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
    return source.stem if source.suffix.lower() == '.theme' else msstyles.stem


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
