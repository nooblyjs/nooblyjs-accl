---
name: staging-01
role: app
account: stevie-aws
status: stopped
spec:
  region: af-south-1
  zone: af-south-1b
  machineType: t3.small
  image: ubuntu-2404-lts
  diskGb: 40
  docker: true
  sshKeyId: key_seedmacbook
  sshFrom: my-ip
ref:
  network: net-seedaws1
  instance: vm-seedstg01
  address: ip-seedstg01
observed:
  status: stopped
  publicIp: 198.51.100.77
  privateIp: 10.20.0.22
  machineType: t3.small
  seenAt: '{{ago:3m}}'
startedAt: '{{ago:27d}}'
runtime:
  docker: 27.3.1
stoppedAt: '{{ago:1d}}'
createdAt: '{{ago:27d}}'
createdBy: { id: stevie, name: Stevie }
---
