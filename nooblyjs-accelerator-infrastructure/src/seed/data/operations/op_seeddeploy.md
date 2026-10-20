---
id: op_seeddeploy
type: app.deploy
resource: { type: app, name: docs }
account: stevie-prod
label: Deploy docs 77be014
status: running
progress: 33
steps:
  - { key: connect, label: Connect, status: done }
  - { key: clone, label: Clone, status: done }
  - { key: dockerfile, label: Read Dockerfile, status: done }
  - { key: build, label: Build image, status: running }
  - { key: start, label: Start new container, status: pending }
  - { key: health, label: Health check, status: pending }
  - { key: switch, label: Switch traffic, status: pending }
  - { key: stop-old, label: Stop previous container, status: pending }
  - { key: clean, label: Clean up old images, status: pending }
state: {}
input: {}
requestedBy: { id: stevie, name: Stevie }
createdAt: '{{ago:1m}}'
startedAt: '{{ago:1m}}'
---

{{ago:1m}}  Queued: Deploy docs 77be014 (by Stevie)
{{ago:1m}}  Started
