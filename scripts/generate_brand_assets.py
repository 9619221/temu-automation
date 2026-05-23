from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build"
ICON_PNG = BUILD_DIR / "icon.png"
ICON_ICO = BUILD_DIR / "icon.ico"


def ensure_build_dir() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)


def draw_background(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    draw = ImageDraw.Draw(image)
    margin = int(size * 0.08)
    radius = int(size * 0.22)

    shadow_draw.rounded_rectangle(
        (margin, margin + int(size * 0.018), size - margin, size - margin + int(size * 0.018)),
        radius=radius,
        fill=(60, 64, 67, 42),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(size * 0.024)))
    image.alpha_composite(shadow)

    draw.rounded_rectangle(
        (margin, margin, size - margin, size - margin),
        radius=radius,
        fill="#FFFFFF",
        outline="#D2E3FC",
        width=max(2, int(size * 0.012)),
    )
    draw.rounded_rectangle(
        (margin + int(size * 0.032), margin + int(size * 0.032), size - margin - int(size * 0.032), size - margin - int(size * 0.032)),
        radius=int(size * 0.18),
        outline=(232, 240, 254, 180),
        width=max(1, int(size * 0.006)),
    )
    return image


def draw_mark(size: int) -> Image.Image:
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    blue = "#1A73E8"
    green = "#34A853"
    yellow = "#FBBC04"
    red = "#EA4335"

    bar = (
        int(size * 0.255),
        int(size * 0.255),
        int(size * 0.745),
        int(size * 0.355),
    )
    stem = (
        int(size * 0.445),
        int(size * 0.332),
        int(size * 0.555),
        int(size * 0.735),
    )
    join = (
        int(size * 0.445),
        int(size * 0.332),
        int(size * 0.555),
        int(size * 0.445),
    )
    draw.rounded_rectangle(bar, radius=int(size * 0.05), fill=blue)
    draw.rounded_rectangle(stem, radius=int(size * 0.055), fill=green)
    draw.rounded_rectangle(join, radius=int(size * 0.028), fill=yellow)

    accent_r = int(size * 0.066)
    accent_center = (int(size * 0.68), int(size * 0.68))
    draw.ellipse(
        (
            accent_center[0] - accent_r,
            accent_center[1] - accent_r,
            accent_center[0] + accent_r,
            accent_center[1] + accent_r,
        ),
        fill=red,
    )
    draw.ellipse(
        (
            accent_center[0] - int(accent_r * 0.42),
            accent_center[1] - int(accent_r * 0.42),
            accent_center[0] + int(accent_r * 0.42),
            accent_center[1] + int(accent_r * 0.42),
        ),
        fill="#FFFFFF",
    )

    node_r = int(size * 0.025)
    for center, color in [
        ((int(size * 0.30), int(size * 0.30)), yellow),
        ((int(size * 0.50), int(size * 0.30)), blue),
        ((int(size * 0.50), int(size * 0.71)), green),
    ]:
        draw.ellipse(
            (center[0] - node_r, center[1] - node_r, center[0] + node_r, center[1] + node_r),
            fill="#FFFFFF",
        )
        draw.ellipse(
            (center[0] - int(node_r * 0.55), center[1] - int(node_r * 0.55), center[0] + int(node_r * 0.55), center[1] + int(node_r * 0.55)),
            fill=color,
        )

    return layer


def create_icon(size: int = 512) -> Image.Image:
    base = draw_background(size)
    mark = draw_mark(size)
    return Image.alpha_composite(base, mark)


def main() -> None:
    ensure_build_dir()
    icon = create_icon()
    icon.save(ICON_PNG, format="PNG")
    icon.save(ICON_ICO, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"Generated {ICON_PNG}")
    print(f"Generated {ICON_ICO}")


if __name__ == "__main__":
    main()
