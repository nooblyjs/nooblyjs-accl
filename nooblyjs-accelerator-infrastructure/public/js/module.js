// Noobly Cloud's UI module for the launcher's frame (architecture.md §11.1): the route table the frame matches,
// relative to the mount path (product.md §5). The launcher draws the rail, the sidebar (from register()'s `nav`), the
// person and the chat; this accelerator draws the content area only. Pages take render(view, { params, query, ctx,
// route }); the frame aborts ctx.signal when the person leaves, which stops their requests and timers. The first
// matching route wins, so /vms/new comes before /vms/:name.
export const routes = [
  { path: '/', nav: 'overview', title: 'Infrastructure', page: () => import('./pages/overview.js') },
  { path: '/vms', nav: 'vms', title: 'Virtual machines', page: () => import('./pages/vms.js') },
  { path: '/vms/new', nav: 'vms', title: 'Launch a Linux VM', page: () => import('./pages/vm-launch.js') },
  { path: '/vms/:name', nav: 'vms', title: 'Virtual machine', page: () => import('./pages/vm.js') },
  { path: '/apps', nav: 'apps', title: 'Apps', page: () => import('./pages/apps.js') },
  { path: '/apps/new', nav: 'apps', title: 'Deploy an app from Git', page: () => import('./pages/app-deploy.js') },
  { path: '/apps/:name', nav: 'apps', title: 'App', page: () => import('./pages/app.js') },
  { path: '/databases', nav: 'databases', title: 'Databases', page: () => import('./pages/databases.js') },
  { path: '/databases/new', nav: 'databases', title: 'Create a database', page: () => import('./pages/database-create.js') },
  { path: '/databases/:name', nav: 'databases', title: 'Database', page: () => import('./pages/databases.js') },
  { path: '/buckets', nav: 'buckets', title: 'Buckets', page: () => import('./pages/buckets.js') },
  { path: '/buckets/new', nav: 'buckets', title: 'Create a bucket', page: () => import('./pages/bucket-create.js') },
  { path: '/buckets/:name', nav: 'buckets', title: 'Bucket', page: () => import('./pages/buckets.js') },
  { path: '/accounts', nav: 'overview', title: 'Cloud accounts', page: () => import('./pages/accounts.js') },
  { path: '/activity', nav: 'overview', title: 'Activity', page: () => import('./pages/activity.js') },
];
