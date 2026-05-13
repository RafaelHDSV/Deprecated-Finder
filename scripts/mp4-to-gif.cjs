/**
 * Builds media/demo.gif from demo.mp4 (palette GIF for README / Marketplace).
 * Requires devDependency ffmpeg-static.
 */
const path = require('path')
const { execFileSync } = require('child_process')
const ffmpeg = require('ffmpeg-static')

const root = path.join(__dirname, '..')
const input = path.join(root, 'demo.mp4')
const output = path.join(root, 'media', 'demo.gif')

/** Downscale, limit fps, palette for smaller file + acceptable colours */
const vf =
  'fps=10,scale=800:-1:flags=lanczos,' +
  'split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=single[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3'

execFileSync(
  ffmpeg,
  ['-y', '-i', input, '-vf', vf, '-loop', '0', output],
  { stdio: 'inherit' }
)

const bytes = require('fs').statSync(output).size
console.log('Wrote', output, `(${Math.round(bytes / 1024)} KiB)`)
