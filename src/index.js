

const AWS = require('aws-sdk');
const sharp = require('sharp');

const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const sns = new AWS.SNS();

// Configuration for image sizes
const SIZES = {
  thumbnail: { width: 150, height: 150 },
  medium: { width: 800, height: 800 },
  large: { width: 1600, height: 1600 }
};

exports.handler = async (event) => {
  try {
    // Handle both S3 and API Gateway events
    const records = event.Records || [{ 
      s3: {
        bucket: { name: event.sourceBucket || process.env.SOURCE_BUCKET },
        object: { key: event.sourceKey }
      }
    }];

    for (const record of records) {
      const sourceBucket = record.s3.bucket.name;
      const sourceKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      
      // Get the source image
      const sourceImage = await s3.getObject({
        Bucket: sourceBucket,
        Key: sourceKey
      }).promise();

      // Get image metadata
      const metadata = await sharp(sourceImage.Body).metadata();
      const imageId = sourceKey.split('/').pop().split('.')[0];

      // Process image for each size
      const processedImages = await Promise.all(
        Object.entries(SIZES).map(async ([size, dimensions]) => {
          const processedImage = await sharp(sourceImage.Body)
            .resize(dimensions.width, dimensions.height, {
              fit: 'inside',
              withoutEnlargement: true
            })
            .jpeg({ quality: 80 })
            .toBuffer();

          const targetKey = `${size}/${imageId}.jpg`;

          // Upload processed image
          await s3.putObject({
            Bucket: process.env.PROCESSED_BUCKET,
            Key: targetKey,
            Body: processedImage,
            ContentType: 'image/jpeg'
          }).promise();

          return {
            size,
            key: targetKey,
            width: dimensions.width,
            height: dimensions.height
          };
        })
      );

      // Store metadata in DynamoDB
      const timestamp = new Date().toISOString();
      await dynamodb.put({
        TableName: process.env.METADATA_TABLE,
        Item: {
          image_id: imageId,
          original_key: sourceKey,
          original_size: sourceImage.ContentLength,
          original_width: metadata.width,
          original_height: metadata.height,
          processed_versions: processedImages,
          processed_at: timestamp,
          mime_type: metadata.format,
        }
      }).promise();

      // Send SNS notification
      await sns.publish({
        TopicArn: process.env.SNS_TOPIC_ARN,
        Message: JSON.stringify({
          status: 'complete',
          imageId: imageId,
          original: {
            key: sourceKey,
            size: sourceImage.ContentLength,
            width: metadata.width,
            height: metadata.height
          },
          processed: processedImages,
          timestamp: timestamp
        }),
        Subject: 'Image Processing Complete'
      }).promise();
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Image processing complete',
        images: records.length
      })
    };

  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
};
