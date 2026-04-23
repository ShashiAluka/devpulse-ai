─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket         = "devpulse-tfstate-dev"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "devpulse-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "devpulse-ai"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name_prefix = "devpulse-${var.environment}"
}

module "lambda_ingest" {
  source        = "../../modules/lambda"
  function_name = "${local.name_prefix}-ingest"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  source_path   = "../../../services/ingest"
  timeout       = 30
  memory_size   = 256
  environment_variables = {
    DYNAMO_TABLE   = aws_dynamodb_table.events.name
    EVENT_BUS_NAME = aws_cloudwatch_event_bus.main.name
    AWS_REGION     = var.aws_region
  }
}

module "lambda_embedder" {
  source        = "../../modules/lambda"
  function_name = "${local.name_prefix}-embedder"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  source_path   = "../../../services/embedder"
  timeout       = 60
  memory_size   = 512
  environment_variables = {
    PINECONE_API_KEY    = var.pinecone_api_key
    PINECONE_INDEX      = var.pinecone_index
    BEDROCK_EMBED_MODEL = var.bedrock_embed_model
    AWS_REGION          = var.aws_region
  }
}

module "lambda_rag_query" {
  source        = "../../modules/lambda"
  function_name = "${local.name_prefix}-rag-query"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  source_path   = "../../../services/rag-query"
  timeout       = 60
  memory_size   = 512
  environment_variables = {
    PINECONE_API_KEY    = var.pinecone_api_key
    PINECONE_INDEX      = var.pinecone_index
    BEDROCK_MODEL_ID    = var.bedrock_model_id
    BEDROCK_EMBED_MODEL = var.bedrock_embed_model
    DYNAMO_TABLE        = aws_dynamodb_table.events.name
    AWS_REGION          = var.aws_region
  }
}

module "lambda_summarizer" {
  source        = "../../modules/lambda"
  function_name = "${local.name_prefix}-summarizer"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  source_path   = "../../../services/summarizer"
  timeout       = 120
  memory_size   = 512
  environment_variables = {
    BEDROCK_MODEL_ID = var.bedrock_model_id
    DYNAMO_TABLE     = aws_dynamodb_table.events.name
    AWS_REGION       = var.aws_region
  }
}

resource "aws_dynamodb_table" "events" {
  name         = "${local.name_prefix}-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute { name = "pk", type = "S" }
  attribute { name = "sk", type = "S" }
  ttl { attribute_name = "ttl", enabled = true }
  point_in_time_recovery { enabled = true }
}

resource "aws_cloudwatch_event_bus" "main" {
  name = "${local.name_prefix}-events"
}

resource "aws_sqs_queue" "embedder_dlq" {
  name                      = "${local.name_prefix}-embedder-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "embedder" {
  name                       = "${local.name_prefix}-embedder"
  visibility_timeout_seconds = 120
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.embedder_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_cloudwatch_event_rule" "activity_created" {
  name           = "${local.name_prefix}-activity-created"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  event_pattern  = jsonencode({ source = ["devpulse.ingest"], "detail-type" = ["activity.created"] })
}

resource "aws_cloudwatch_event_target" "to_sqs" {
  rule           = aws_cloudwatch_event_rule.activity_created.name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  target_id      = "EmbedderQueue"
  arn            = aws_sqs_queue.embedder.arn
}

resource "aws_cognito_user_pool" "main" {
  name = "${local.name_prefix}-users"
  password_policy {
    minimum_length    = 8
    require_uppercase = true
    require_numbers   = true
  }
  auto_verified_attributes = ["email"]
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name_prefix}-web-client"
  user_pool_id = aws_cognito_user_pool.main.id
  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
}
