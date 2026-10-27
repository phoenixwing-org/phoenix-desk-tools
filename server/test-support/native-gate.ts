import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll} from 'vitest';
import {configureDrawingExecutionBarrier} from '../src/features/drawing-research/executionGate.js';

/** Explicit disposable host scope for mock/native-lifecycle unit tests only.
 * Production never discovers this fixture or bypasses a real host barrier. */
export function installPrivateNativeGateForTest():void {
  const folder=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-native-gate-unit-')));
  configureDrawingExecutionBarrier(path.join(folder,'host-native'));
  afterAll(()=>{fs.rmSync(folder,{recursive:true,force:true});});
}
