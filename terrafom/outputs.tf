# Outputs
output "source_bucket_name" {
  value = aws_s3_bucket.source_bucket.id
}

output "processed_bucket_name" {
  value = aws_s3_bucket.processed_bucket.id
}

output "api_endpoint" {
  value = "${aws_api_gateway_stage.api_stage.invoke_url}/process"
}

output "sns_topic_arn" {
  value = aws_sns_topic.processing_complete.arn
}