# The logo and every file made from it

One source: the 2026 logo, a 2000x2000 transparent PNG the user drew (kept outside the repo; every
file below is generated from it, cropped square to the drawing with a 2% margin). It replaced the
illustrated logo, whose `MiGallery.png` weighed 716 KB and was the link-preview image of every page.

| File in `static/`      | Size             | Used by                                                                         | Why this shape                                                                                                   |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `logo.webp`            | 256px, ~20 KB    | the top bar and the home page                                                   | transparent; covers 2x the largest display (120 CSS px)                                                          |
| `favicon.ico`          | 16/32/48         | browser tabs                                                                    | the tight crop, which still reads at 16px                                                                        |
| `icon-192.png`         | 192px, ~9 KB     | `<link rel="icon">` for browsers that take a PNG                                | palette PNG                                                                                                      |
| `apple-touch-icon.png` | 180px, ~7 KB     | iOS home screen                                                                 | OPAQUE white with padding: iOS paints transparency black, and rounds the corners itself                          |
| `og-image.jpg`         | 1200x630, ~42 KB | the preview of every link without its own (`DEFAULT_IMAGE` in `src/lib/seo.ts`) | a JPEG because not every unfurler reads WebP; its size is declared, and a test reads the file to hold it to that |
| `logo-512.png`         | 512px, ~25 KB    | `README.md`                                                                     | palette PNG                                                                                                      |

The same logo is Portail-etu's MiGallery link (`static/links/migallery.png` there). To regenerate: crop
the source to its alpha bounding box, resize with Lanczos, quantize the PNGs to 256 colours.
