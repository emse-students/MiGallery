import fs from 'fs'
import path from 'path'
import * as tar from 'tar'

const pkgPath = path.resolve(process.cwd(), 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const version = pkg.version || '0.0.0'
const name = pkg.name || 'package'

const outDir = path.resolve(process.cwd(), 'build', 'artifacts')
await fs.promises.mkdir(outDir, { recursive: true })

const filename = `${name.replace(/[^a-z0-9.-]/gi, '_')}-${version}.tgz`
const outPath = path.join(outDir, filename)

console.log(`Creating tar.gz: ${outPath} from ./build ...`)

// Create a tar.gz of the build/ directory contents
await tar.create(
	{
		gzip: true,
		file: outPath,
		cwd: path.resolve(process.cwd(), 'build')
	},
	['.']
)

console.log('Packaging complete.')
console.log(outPath)
