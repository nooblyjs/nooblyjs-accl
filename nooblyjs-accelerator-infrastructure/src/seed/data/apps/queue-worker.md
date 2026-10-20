---
name: queue-worker
vm: worker-01
status: live
source:
  repo: https://github.com/stevie/queue-worker.git
  branch: main
  dockerfile: ./Dockerfile
  context: .
  gitConnection: github-stevie
run:
  port: 8000
  restart: always
  env:
    - { key: DATABASE_URL, link: { database: analytics } }
healthCheck: /healthz
autoDeploy: false
current:
  commit: 0f9a6c3
  deployedAt: '{{ago:6d}}'
  trigger: person
  by: { id: stevie, name: Stevie }
createdAt: '{{ago:20d}}'
createdBy: { id: stevie, name: Stevie }
---
