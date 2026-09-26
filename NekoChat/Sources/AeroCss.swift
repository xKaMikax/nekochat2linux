import Foundation

extension MsStylesImporter {
    /// Windows 7 Aero Glass stylesheet from write_aero_scheme() in tools/import_msstyles.py.
    static let aeroCss = #"""
/* Windows 7 Aero Glass renderer generated for Aero.msstyles. */
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
"""#
}
