import { execSync } from "child_process";
import rimraf from 'rimraf';
import { mkdirSync, copyFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

function exec(cmd: string) {
  execSync(cmd, {stdio: 'inherit'});
}

interface mkdirData {
  [k: string]: mkdirData | undefined
}

function mkdirp(tree?: mkdirData, path?: string) {
  if (!tree) {
    return;
  }
  Object.keys(tree).forEach((k) => {
    const p = path ? join(path, k) : k;
    mkdirSync(p);
    mkdirp(tree[k], p);
  })
}

async function makeFunctionPackage() {
  await new Promise<void>((resolve, reject) => rimraf('pkg', (err) => {
    if(err) {
      reject(err);
    } else {
      resolve();
    }
  }));
  mkdirp({
    pkg: {
      deps: { grpc: { etc: undefined } },
      grpc: undefined,
      dist: { src: undefined },
    }
  });
  [
    ['node_modules/grpc/deps/grpc/etc/roots.pem', 'pkg/deps/grpc/etc/roots.pem'],
    ['node_modules/grpc/package.json', 'pkg/grpc/package.json'],
    ['worker.config.json', 'pkg/worker.config.json'],
  ].forEach(v => copyFileSync(v[0], v[1]));
  exec('webpack')
  const archMatrix: Array<{
    nodeVersion: string;
    arch: string;
    platforms: {name: string, libc: string}[];
  }> = [
    {
      nodeVersion: '8.4.0',
      arch: 'ia32',
      platforms: [
        {
          name: 'win32',
          libc: 'unknown',
        },{
          name: 'darwin',
          libc: 'unknown',
        },
        {
          name: 'linux',
          libc: 'glibc',
        },
      ],
    },
    {
      nodeVersion: '10.1.0',
      arch: 'ia32',
      platforms: [
        {
          name: 'win32',
          libc: 'unknown',
        },{
          name: 'darwin',
          libc: 'unknown',
        },
        {
          name: 'linux',
          libc: 'glibc',
        },
      ],
    },
    {
      nodeVersion: '12.13.0',
      arch: 'ia32',
      platforms: [
        {
          name: 'win32',
          libc: 'unknown',
        },{
          name: 'darwin',
          libc: 'unknown',
        },
        {
          name: 'linux',
          libc: 'glibc',
        },
      ],
    },
    {
      nodeVersion: '8.4.0',
      arch: 'x64',
      platforms: [
        {
          name: 'win32',
          libc: 'unknown',
        },{
          name: 'darwin',
          libc: 'unknown',
        },
        {
          name: 'linux',
          libc: 'glibc',
        },
      ],
    },
    {
      nodeVersion: '10.1.0',
      arch: 'x64',
      platforms: [
        {
          name: 'win32',
          libc: 'unknown',
        },{
          name: 'darwin',
          libc: 'unknown',
        },
        {
          name: 'linux',
          libc: 'glibc',
        },
      ],
    },
    {
      nodeVersion: '12.13.0',
      arch: 'x64',
      platforms: [
        {
          name: 'win32',
          libc: 'unknown',
        },{
          name: 'darwin',
          libc: 'unknown',
        },
        {
          name: 'linux',
          libc: 'glibc',
        },
      ],
    }
  ]
  archMatrix.forEach(el => el.platforms.forEach(pl => exec(
    `node-pre-gyp install -C pkg/grpc --target_arch=${el.arch} --target=${el.nodeVersion} --target_platform=${pl.name} --target_libc=${pl.libc}`
  )))
}

makeFunctionPackage().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
})
