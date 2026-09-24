---
description: Commit and push the current project changes to GitHub
agent: build
---
Проведи полный deploy текущих изменений в GitHub.

Сначала изучи `git status`, `git diff` и `git log --oneline -10`. Запусти доступные lint, typecheck и test-команды проекта; если зависимости отсутствуют, установи их только из существующего `package.json`. Исправь найденные ошибки и повтори проверки.

Создай commit только с текущими изменениями, не добавляй секреты, временные файлы и пустые коммиты. Определи текущую ветку и remote, затем выполни push с force. Если remote отсутствует или push не удался, остановись и сообщи причину.

В конце сообщи commit hash, ветку, remote и результаты проверок.
