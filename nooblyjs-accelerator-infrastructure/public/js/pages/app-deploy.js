// Deploy an app from Git (infra-deploy-a-app/DeployApp.dc.html; product.md §6.6). Built in roadmap phase 6.
import { placeholder } from '../lib.js';

export async function render(view, { ctx }) {
  placeholder(view, ctx, {
    trail: [['Apps', '/apps'], ['Deploy']],
    title: 'Deploy an app from Git',
    lead: 'We clone the repo, build its Dockerfile on your VM and put it behind HTTPS.',
    phase: 6,
    what: 'Source, the VM it runs on, run settings with environment variables, and a public endpoint with a health check.',
  });
}
