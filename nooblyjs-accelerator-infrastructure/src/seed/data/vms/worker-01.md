---
name: worker-01
role: app
account: stevie-prod
status: running
spec:
  region: africa-south1
  zone: africa-south1-b
  machineType: e2-standard-4
  image: debian-12
  diskGb: 50
  docker: true
  sshKeyId: key_seedmacbook
  sshFrom: my-ip
ref:
  instance: vm-seedwrk01
  address: ip-seedwrk01
observed:
  status: running
  publicIp: 203.0.113.117
  privateIp: 10.10.0.21
  machineType: e2-standard-4
  seenAt: '{{ago:3m}}'
createdAt: '{{ago:20d}}'
createdBy: { id: stevie, name: Stevie }
---
