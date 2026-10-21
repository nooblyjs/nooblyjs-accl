// First boot (architecture.md §9): the cloud-init user-data every VM is launched with. The person's SSH key goes to the
// image's default user (ubuntu, debian, rocky); the install's control key to `noobly`, the user Noobly Cloud works as.
// Docker is installed when asked, and /var/lib/noobly/ready marks the end. Written as JSON, which is valid YAML, so
// nothing put in it can change its structure.

const PUBLIC_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/]+={0,3}( [^\n\r]{0,200})?$/;
export const isPublicKey = (key) => typeof key === 'string' && PUBLIC_KEY.test(key.trim());

/** How Docker is installed on each image family: the distribution's own package, or Docker's repository. */
const DOCKER = {
  apt: { packages: ['docker.io'], runcmd: [] },
  dnf: {
    packages: ['dnf-plugins-core'],
    runcmd: [['dnf', 'config-manager', '--add-repo', 'https://download.docker.com/linux/centos/docker-ce.repo'], ['dnf', 'install', '-y', 'docker-ce', 'docker-ce-cli', 'containerd.io']],
  },
};

/**
 * @param {object} o
 * @param {string} o.personKey     the person's public key
 * @param {string} o.controlKey    the install's control public key
 * @param {boolean} [o.docker]
 * @param {'apt'|'dnf'} [o.packages]  the image's package manager
 * @returns {string} #cloud-config user-data
 */
export function cloudInit({ personKey, controlKey, docker = true, packages = 'apt' }) {
  if (!isPublicKey(personKey)) throw new Error('cloudInit: the person\'s key is not an SSH public key.');
  if (!isPublicKey(controlKey)) throw new Error('cloudInit: the control key is not an SSH public key.');
  const install = DOCKER[packages] ?? DOCKER.apt;
  const config = {
    users: [
      'default',
      { name: 'noobly', gecos: 'Noobly Cloud', shell: '/bin/bash', sudo: 'ALL=(ALL) NOPASSWD:ALL', ssh_authorized_keys: [controlKey.trim()] },
    ],
    ssh_authorized_keys: [personKey.trim()],
    ssh_pwauth: false,
    package_update: true,
    packages: docker ? install.packages : [],
    runcmd: [
      ...(docker ? [...install.runcmd, ['systemctl', 'enable', '--now', 'docker'], ['usermod', '-aG', 'docker', 'noobly']] : []),
      ['mkdir', '-p', '/var/lib/noobly'],
      ['touch', '/var/lib/noobly/ready'],
    ],
  };
  return `#cloud-config\n${JSON.stringify(config, null, 2)}\n`;
}
