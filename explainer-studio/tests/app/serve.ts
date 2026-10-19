// Test-only: runs the app server in its own process on a given (temporary) workspace so that tests can kill it the hard way.
// The product launcher (app/main.ts) opens only the demo workspace; this file is not a way to open real projects.
import {resolve} from 'node:path';
import {ROOT} from '../../app/demo.ts';
import {JobService} from '../../app/jobs.ts';
import {createApp} from '../../app/server.ts';
import {Project} from '../../core/project.ts';
import {jobOptions, recordFakeTools} from './jobs-fixture.ts';

const [projectRoot, dist, port, faultFile] = process.argv.slice(2);
const project = Project.open(projectRoot);
// STUDIO_TEST_FAKE=1: rebuilds run on the fake audio and render workers (the workspace records them as its tools).
let jobs: JobService | undefined;
if (process.env.STUDIO_TEST_FAKE === '1') { recordFakeTools(project); jobs = new JobService(jobOptions(project, projectRoot)); }
const app = createApp({project, projectRoot, jobs, workspaceLabel: 'Test workspace', distDir: dist, publicDir: resolve(ROOT, 'public'), port: Number(port), faultFile});
const p = await app.start();
console.log(`READY ${p}`);
process.on('SIGTERM', async () => { await app.stop(); await jobs?.shutdown(); project.close(); process.exit(0); });
