import del from 'del'
import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'
import tempy from 'tempy'
import './__env__'
import * as installer from '../'
import { huskyIdentifier } from '../getScript'

// RandomId to verify that scripts get updated
const randomId = Math.random().toString()

// Temporary dir updated for each test
let tempDir: string

const pkg = JSON.stringify({})

// Helpers
function install({
  gitCommonDir = '.git',
  relativeUserPkgDir = '.',
  userPkgDir = '.',
  isCI = false
}: {
  gitCommonDir?: string
  relativeUserPkgDir?: string
  userPkgDir?: string
  isCI?: boolean
} = {}): void {
  installer.install({
    absoluteGitCommonDir: path.join(tempDir, gitCommonDir),
    relativeUserPkgDir,
    userPkgDir: path.join(tempDir, userPkgDir),
    pmName: 'npm',
    isCI
  })
}

function uninstall({
  gitCommonDir = '.git',
  userPkgDir = '.'
}: {
  gitCommonDir?: string
  userPkgDir?: string
} = {}): void {
  installer.uninstall({
    absoluteGitCommonDir: path.join(tempDir, gitCommonDir),
    userPkgDir
  })
}

function mkdir(dirs: string[]): void {
  dirs.forEach((dir): mkdirp.Made => mkdirp.sync(path.join(tempDir, dir)))
}

function rmdir(dir: string): void {
  fs.rmdirSync(path.join(tempDir, dir))
}

function writeFile(filename: string, data: string): void {
  fs.writeFileSync(path.join(tempDir, filename), data)
}

function readFile(filename: string): string {
  return fs.readFileSync(path.join(tempDir, filename), 'utf-8')
}

function exists(filename: string): boolean {
  return fs.existsSync(path.join(tempDir, filename))
}

function expectHookToExist(filename: string): void {
  const hook = readFile(filename)
  expect(hook).toMatch(huskyIdentifier)
}

type HookManager = {
  name: string
  hookContent: string
}

const hooksManagers: HookManager[] = [
  {
    name: 'ghooks',
    hookContent: '// Generated by ghooks. Do not edit this file.'
  },
  { name: 'pre-commit', hookContent: './node_modules/pre-commit/hook' }
]

function testMigration({ name, hookContent }: HookManager): void {
  it(`should migrate existing scripts (${name})`, (): void => {
    writeFile('package.json', pkg)
    writeFile('.git/hooks/pre-commit', hookContent)

    install()
    expectHookToExist('.git/hooks/pre-commit')
  })
}

// Tests
describe('install', (): void => {
  beforeEach((): void => {
    delete process.env.INIT_CWD
    tempDir = tempy.directory()
    mkdir(['.git/hooks'])
  })

  afterEach((): Promise<string[]> => del(tempDir, { force: true }))

  it('should install and uninstall', (): void => {
    writeFile('package.json', pkg)

    install()
    expectHookToExist('.git/hooks/pre-commit')

    const hook = readFile('.git/hooks/pre-commit')
    expect(hook).toMatch('cd "."')

    uninstall()
    expect(exists('.git/hooks/pre-commit')).toBeFalsy()
  })

  it('should update existing husky hooks', (): void => {
    writeFile('package.json', pkg)

    // Create an existing husky hook
    writeFile('.git/hooks/pre-commit', `# husky\n${randomId}`)

    // Verify that it has been updated
    install()
    const hook = readFile('.git/hooks/pre-commit')
    expect(hook).toContain('# husky')
    expect(hook).not.toContain(randomId)
  })

  it('should update existing husky hooks (v0.14 and earlier)', (): void => {
    writeFile('package.json', pkg)

    // Create an existing husky hook
    writeFile('.git/hooks/pre-commit', `#!/bin/sh\n#husky 0.14.3\n${randomId}`)

    // Verify that it has been updated
    install()
    const hook = readFile('.git/hooks/pre-commit')
    expect(hook).toContain('# husky')
    expect(hook).not.toContain(randomId)
  })

  it('should not modify user hooks', (): void => {
    writeFile('package.json', pkg)
    writeFile('.git/hooks/pre-commit', 'foo')

    // Verify that it's not overwritten
    install()
    const hook = readFile('.git/hooks/pre-commit')
    expect(hook).toBe('foo')

    // Verify that it's not deleted
    uninstall()
    expect(exists('.git/hooks/pre-commit')).toBeTruthy()
  })

  it('should support package.json installed in sub directory', (): void => {
    const relativeUserPkgDir = 'A/B/'
    mkdir([relativeUserPkgDir])
    writeFile('A/B/package.json', pkg)

    install({ relativeUserPkgDir, userPkgDir: relativeUserPkgDir })
    const hook = readFile('.git/hooks/pre-commit')

    expect(hook).toMatch('cd "A/B/"')

    uninstall({ userPkgDir: relativeUserPkgDir })
    expect(exists('.git/hooks/pre-commit')).toBeFalsy()
  })

  it('should support git submodule', (): void => {
    const gitCommonDir = '.git/modules/A/B'
    const userPkgDir = 'A/B'

    mkdir(['.git/modules/A/B/hooks', userPkgDir])
    writeFile('A/B/package.json', pkg)

    install({
      gitCommonDir,
      userPkgDir
    })
    const hook = readFile('.git/modules/A/B/hooks/pre-commit')

    expect(hook).toMatch('cd "."')

    uninstall({ gitCommonDir, userPkgDir })
    expect(exists('.git/modules/A/B/hooks/pre-commit')).toBeFalsy()
  })

  it('should not install from node_modules/A', (): void => {
    const userPkgDir = 'node_modules/A'

    mkdir([userPkgDir])
    writeFile('node_modules/A/package.json', '{}')
    writeFile('package.json', pkg)

    install({ userPkgDir })
    expect(exists('.git/hooks/pre-commit')).toBeFalsy()
  })

  it('should not install hooks in CI server', (): void => {
    writeFile('package.json', pkg)

    // By default isCI is false in husky's test
    install({ isCI: true })
    expect(exists('.git/hooks/pre-commit')).toBeFalsy()
  })

  it('should install in CI server if skipCI is set to false', (): void => {
    writeFile('package.json', JSON.stringify({ husky: { skipCI: false } }))

    install()
    expectHookToExist('.git/hooks/pre-commit')
  })

  it("should install even if .git/hooks doesn't exist", (): void => {
    // Create only Git common dir but hooks dir
    rmdir('.git/hooks')
    writeFile('package.json', pkg)

    install()
    expectHookToExist('.git/hooks/pre-commit')
  })

  hooksManagers.forEach(testMigration)
})
