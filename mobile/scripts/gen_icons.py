from pathlib import Path
from PIL import Image

src = Path(r"e:\python\openmusic\client\public\favicon-512.png")
img = Image.open(src).convert("RGBA")
res = Path(r"e:\python\openmusic\mobile\android\app\src\main\res")
assets = Path(r"e:\python\openmusic\mobile\assets\brand")
assets.mkdir(parents=True, exist_ok=True)
img.save(assets / "icon.png")

sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
for folder, size in sizes.items():
    d = res / folder
    d.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.Resampling.LANCZOS).save(d / "ic_launcher.png")

fg_dir = res / "drawable"
fg_dir.mkdir(parents=True, exist_ok=True)
img.resize((432, 432), Image.Resampling.LANCZOS).save(fg_dir / "ic_launcher_foreground.png")

# White notification silhouette for MediaStyle
small = img.resize((72, 72), Image.Resampling.LANCZOS)
white = Image.new("RGBA", (72, 72), (0, 0, 0, 0))
sp, wp = small.load(), white.load()
for y in range(72):
    for x in range(72):
        r, g, b, a = sp[x, y]
        if a > 40:
            wp[x, y] = (255, 255, 255, a)
notif = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
notif.paste(white, (12, 12), white)
notif.save(fg_dir / "ic_stat_notify.png")

# iOS AppIcon 1024
ios = Path(
    r"e:\python\openmusic\mobile\ios\Runner\Assets.xcassets\AppIcon.appiconset"
)
if ios.exists():
    img.resize((1024, 1024), Image.Resampling.LANCZOS).save(
        ios / "Icon-App-1024x1024@1x.png"
    )

print("icons generated")
