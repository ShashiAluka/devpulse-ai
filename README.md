# DevPulse AI

![AWS](https://img.shields.io/badge/AWS-Serverless-orange?logo=amazon-aws) ![Terraform](https://img.shields.io/badge/IaC-Terraform-7B42BC?logo=terraform) ![React](https://img.shields.io/badge/Frontend-React+TypeScript-61DAFB?logo=react) ![License](https://img.shields.io/badge/license-MIT-green)

A serverless AI-powered developer productivity platform built on AWS. Ask natural language questions about your team engineering activity, get RAG-powered answers with citations, and receive AI-generated sprint summaries in real time.

---

## Architecture

```
React + TypeScript  (S3 + CloudFront)
        |
API Gateway REST + WebSocket + Cognito
        |
 Ingest  Embedder  RAG-Query  Summarizer   (Lambda)
        |
EventBridge + SQS (Dead Letter Queue)
        |
DynamoDB (Sessions)    RDS PostgreSQL (Users/Posts)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS |
| Auth | AWS Cognito JWT |
| API | API Gateway REST + WebSocket |
| Compute | Lambda Node.js 20.x |
| AI / RAG | Bedrock Claude 3 Sonnet + Titan Embeddings |
| Vector DB | Pinecone |
| Events | EventBridge + SQS |
| Databases | DynamoDB + RDS PostgreSQL |
| CDN | CloudFront + S3 |
| IaC | Terraform dev/staging/prod |
| CI/CD | GitLab CI/CD |
| Containers | Docker + ECS Fargate |

---

## Features

### Ask AI (RAG Chat)
Natural language queries powered by Bedrock Titan embeddings, Pinecone vector search, and Claude 3 Sonnet with real-time WebSocket streaming. Example: "What did the team ship this sprint?"

### Live Dashboard
Real-time activity feed via WebSocket, contribution heatmap, and AI-generated Week in Review card from a scheduled Bedrock Lambda.

### Insights
Engagement trend charts, topic clusters from the embedding space, and PR velocity metrics per contributor.

### Event-Driven Pipeline
GitHub webhooks to EventBridge to SQS fanout with DLQ retry and zero-downtime CI/CD deploys.

---

## Project Structure

```
devpulse-ai/
├── frontend/
│   └── src/
│       ├── pages/          # Dashboard, AskAI, Insights
│       ├── components/
│       ├── hooks/
│       └── services/       # API + WebSocket clients
├── services/
│   ├── ingest/             # Lambda: GitHub webhook receiver
│   ├── embedder/           # Lambda: Bedrock embeddings to Pinecone
│   ├── rag-query/          # Lambda: RAG pipeline
│   ├── summarizer/         # Lambda: scheduled AI summaries
│   └── notifications/      # Lambda: EventBridge consumer
├── infra/
│   ├── modules/            # Reusable Terraform modules
│   │   ├── lambda/
│   │   ├── api-gateway/
│   │   ├── eventbridge/
│   │   ├── rds/
│   │   └── dynamodb/
│   └── environments/
│       ├── dev/
│       ├── staging/
│       └── prod/
├── .gitlab-ci.yml
├── docker-compose.yml
└── README.md
```

---

## Getting Started

### Prerequisites
- Node.js 20.x, Terraform >= 1.5, AWS CLI configured, Pinecone API key, Docker

- ### Local Development

- ```bash
  git clone https://github.com/ShashiAluka/devpulse-ai.git
  cd devpulse-ai

  # Start frontend
  cd frontend && npm install && npm run dev

  # Start local services
  docker-compose up -d

  # Deploy infrastructure to dev
  cd infra/environments/dev
  terraform init && terraform plan && terraform apply
  ```

  ### Environment Variables

  ```bash
  AWS_REGION=us-east-1
  PINECONE_API_KEY=your_key
  PINECONE_INDEX=devpulse-embeddings
  BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
  BEDROCK_EMBED_MODEL=amazon.titan-embed-text-v1
  DB_HOST=your-rds-endpoint
  COGNITO_USER_POOL_ID=us-east-1_xxxxx
  ```

  ---

  ## CI/CD Pipeline

  ```
  Push to feature/*  ->  terraform plan (preview only)
  Merge to main      ->  terraform apply dev -> integration tests -> staging
  Tag v*.*.*         ->  deploy to production with zero-downtime rolling update
  ```

  ---

  ## Key Design Decisions

  - **Serverless-first**: All compute via Lambda, auto-scaling, no servers to manage
  - - **IaC everything**: Every AWS resource in Terraform, fully reproducible across envs
    - - **Event-driven**: EventBridge loose coupling, services evolve independently
      - - **RAG over fine-tuning**: Retrieval-Augmented Generation keeps answers current without retraining
        - - **WebSocket real-time**: API Gateway WebSocket eliminates polling entirely
         
          - ---

          ## License

          MIT (c) Shashi Preetham Alukapally
          
