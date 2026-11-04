import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const fail of [false, true]) test(`alta nueva llega al trabajo de radio de CRV${fail ? ' incluso si intake falla' : ''}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'crv-radio-chain-'));
  try {
    for (const dir of ['ops/youtube-canal', 'scripts', 'bin']) mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(new URL('../../ops/youtube-canal/nuevo.sh', import.meta.url), join(root, 'ops/youtube-canal/nuevo.sh'));
    writeFileSync(join(root, 'scripts/with-node22.sh'), '#!/bin/bash\necho "canal $*" >> "$CHAIN_LOG"\nif [[ "$*" == *intake* && "$FAIL_INTAKE" == 1 ]]; then exit 1; fi\n', { mode: 0o700 });
    writeFileSync(join(root, 'bin/systemctl'), '#!/bin/bash\necho "systemctl $*" >> "$CHAIN_LOG"\n', { mode: 0o700 });
    const log = join(root, 'calls');
    const result = spawnSync('/bin/bash', [join(root, 'ops/youtube-canal/nuevo.sh'), 'ABCDEFGHIJK'], { env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, CHAIN_LOG: log, FAIL_INTAKE: fail ? '1' : '0' }, encoding: 'utf8' });
    assert.equal(result.status, fail ? 1 : 0);
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
      'canal npx tsx ops/youtube-canal/canal.ts watch --video=ABCDEFGHIJK',
      'canal npx tsx ops/youtube-canal/canal.ts intake',
      'canal npx tsx ops/youtube-canal/canal.ts complete --video=ABCDEFGHIJK',
      'systemctl --user start crv-radio-catalogo.service',
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
