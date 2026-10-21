TECHNICAL ASSESSMENT: AI TASK BOT
F U L L - S T A C K / A U T O M A T I O N E N G I N E E R I N G T A S K

PROJECT OVERVIEW
Build a production-ready Omni-Channel Task Management System. The goal is to allow users to create
tasks via a Telegram Bot (Text or Voice) and visualize them on a web dashboard with real-time status updates.
TECHNICAL REQUIREMENTS

1. Telegram Interface
Integrate Telegram Bot API.
Support Text Messages for quick task entry.
Support Voice Messages: Use OpenAI
Whisper or similar to transcribe voice to text.

2. Backend & Processing
PostgreSQL: Persistent storage for tasks and
user data.
Redis: Implement as a message broker/
queue for async transcription and notification
tasks.

DASHBOARD & FRONTEND
Create a responsive dashboard using any modern JS Framework (React, Vue, or Next.js):
Display all tasks in a Kanban or List view.
Show real-time updates when a new task is created via the bot.
Implement status toggles (Pending, In Progress, Completed).

DEVOPS & DEPLOYMENT
Containerize the entire application using Docker. Provide a docker-compose.yml file that orchestrates:
Web Frontend & Backend API.
PostgreSQL Database & Redis Instance.
Worker service for transcription/async tasks.

EVALUATION CRITERIA
Code Quality: Clean, modular Python/JS.
Resilience: Proper error handling for voice
processing.

Workflow: Effective use of Redis queues.
UX: Speed of transcription feedback in the bot.

STRICT CONFIDENTIALITY • ENGINEERING INTERN ASSESSMENT • VERSION 1.0