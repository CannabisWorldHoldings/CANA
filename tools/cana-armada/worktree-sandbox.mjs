import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const exec=promisify(execFile);
export async function createDisposableWorktree({repoRoot,baseSha,label='armada'}){const root=await fs.mkdtemp(path.join(os.tmpdir(),`cana-${label}-`));await exec('git',['-C',repoRoot,'worktree','add','--detach',root,baseSha]);return root;}
export async function removeDisposableWorktree({repoRoot,worktree}){try{await exec('git',['-C',repoRoot,'worktree','remove','--force',worktree]);}finally{await fs.rm(worktree,{recursive:true,force:true});}}
export async function worktreeDiff({worktree}){const {stdout}=await exec('git',['-C',worktree,'status','--porcelain=v1']);return stdout.trim();}
