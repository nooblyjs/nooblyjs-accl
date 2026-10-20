// Every screen URL in product.md §5, as a person would type or bookmark it, with the route and page it should land on.
export const PAGES = [
  { url: '/infrastructure', page: 'overview.js', title: 'Infrastructure' },
  { url: '/infrastructure/vms', page: 'vms.js', title: 'Virtual machines' },
  { url: '/infrastructure/vms/new', page: 'vm-launch.js', title: 'Launch a Linux VM' },
  { url: '/infrastructure/vms/web-01', page: 'vm.js', title: 'web-01', params: { name: 'web-01' } },
  { url: '/infrastructure/apps', page: 'apps.js', title: 'Apps' },
  { url: '/infrastructure/apps/new', page: 'app-deploy.js', title: 'Deploy an app from Git' },
  { url: '/infrastructure/apps/storefront', page: 'app.js', title: 'storefront', params: { name: 'storefront' } },
  { url: '/infrastructure/databases', page: 'databases.js', title: 'Databases' },
  { url: '/infrastructure/databases/new', page: 'database-create.js', title: 'Create a database' },
  { url: '/infrastructure/databases/orders-db', page: 'databases.js', title: 'orders-db', params: { name: 'orders-db' } },
  { url: '/infrastructure/buckets', page: 'buckets.js', title: 'Buckets' },
  { url: '/infrastructure/buckets/new', page: 'bucket-create.js', title: 'Create a bucket' },
  { url: '/infrastructure/buckets/stevie-media', page: 'buckets.js', title: 'stevie-media', params: { name: 'stevie-media' } },
  { url: '/infrastructure/accounts', page: 'accounts.js', title: 'Cloud accounts' },
  { url: '/infrastructure/activity', page: 'activity.js', title: 'Activity' },
];

export const PAGE_URLS = PAGES.map((p) => p.url);
