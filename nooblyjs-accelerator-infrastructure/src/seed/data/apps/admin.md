---
name: admin
vm: staging-01
status: stopped
source:
  repo: https://github.com/stevie/admin.git
  branch: develop
  dockerfile: ./Dockerfile
  context: .
  gitConnection: github-stevie
run:
  port: 3000
  restart: always
  env: []
healthCheck: /healthz
autoDeploy: false
current:
  commit: 3ac77e9
  deployedAt: '{{ago:9d}}'
  trigger: person
  by: { id: stevie, name: Stevie }
createdAt: '{{ago:20d}}'
createdBy: { id: stevie, name: Stevie }
---
