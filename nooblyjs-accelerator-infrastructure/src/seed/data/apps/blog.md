---
name: blog
vm: web-01
status: live
source:
  repo: https://github.com/nooblyjs/blog.git
  branch: main
  dockerfile: ./Dockerfile
  context: .
  gitConnection: github-stevie
run:
  port: 8080
  restart: always
  env:
    - { key: NODE_ENV, value: production }
healthCheck: /healthz
autoDeploy: false
current:
  commit: 5d20b8f
  deployedAt: '{{ago:3d}}'
  trigger: person
  by: { id: stevie, name: Stevie }
createdAt: '{{ago:20d}}'
createdBy: { id: stevie, name: Stevie }
---
