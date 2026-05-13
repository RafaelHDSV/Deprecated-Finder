/**
 * Generates media/icon.png (128×128) from media/icon.svg for the Marketplace
 * package.json "icon" field. Activity bar keeps using the SVG.
 */
const path = require('path')
const sharp = require('sharp')

async function main() {
  const root = path.join(__dirname, '..')
  const svgPath = path.join(root, 'media', 'icon.svg')
  const pngPath = path.join(root, 'media', 'icon.png')

  await sharp(svgPath)
    .resize(128, 128, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .png()
    .toFile(pngPath)

  console.log('Wrote', pngPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
