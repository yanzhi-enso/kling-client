// Server-side utilities for interacting with the OpenAI API using the SDK

import OpenAI from "openai";
import dotenv from "dotenv";

// Load environment variables if not already loaded
if (typeof process !== "undefined" && !process.env.OPENAI_API_KEY) {
    dotenv.config();
}

// Lazy initialization of OpenAI client
let openai = null;

function getOpenAIClient() {
    if (!openai) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error(
                "OpenAI API key is not set in environment variables."
            );
        }
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return openai;
}

// Default settings based on requirements
const DEFAULT_GENERATION_MODEL = "gpt-image-1";
const DEFAULT_GENERATION_SIZE = "1024x1536"; // Portrait
const DEFAULT_QUALITY = 'medium'; // Medium quality
const DEFAULT_OUTPUT_FORMAT = 'png';
const DEFAULT_MODERATION = 'low';
const DEFAULT_N = 1;

// Helper function to transform OpenAI SDK errors to our custom format
function transformError(error) {
    // Network-level errors
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_NODATA') {
        return {
            error: 'DNS_ERROR',
            message: 'Unable to resolve API endpoint',
        };
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        return { error: 'NETWORK_ERROR', message: 'Network connection failed' };
    }

    if (error.name === 'AbortError') {
        return { error: 'CONNECTION_TIMEOUT', message: 'Request timed out' };
    }

    // OpenAI SDK-specific errors
    if (error instanceof OpenAI.AuthenticationError) {
        return {
            error: 'INVALID_API_KEY',
            message: 'OpenAI API key is invalid',
        };
    }

    if (error instanceof OpenAI.RateLimitError) {
        return {
            error: 'RATE_LIMIT_EXCEEDED',
            message: 'API rate limit exceeded',
        };
    }

    if (error instanceof OpenAI.BadRequestError) {
        if (error.error?.code === 'moderation_blocked') {
            return {
                error: 'CONTENT_MODERATION_BLOCKED',
                message: 'Content blocked by OpenAI moderation',
            };
        } else {
            return {
                error: 'INVALID_REQUEST',
                message: 'Request parameters are invalid',
            };
        }
    }

    if (error instanceof OpenAI.PermissionDeniedError) {
        return {
            error: 'CONTENT_VIOLATION',
            message: 'Content violates OpenAI policies',
        };
    }

    if (error instanceof OpenAI.InternalServerError) {
        return { error: 'SERVER_ERROR', message: 'OpenAI server error' };
    }

    if (error instanceof OpenAI.APIError) {
        return {
            error: 'API_ERROR',
            message: `OpenAI API error: ${error.message}`,
        };
    }

    return {
        error: 'UNKNOWN_ERROR',
        message: error?.message || 'An unknown error occurred',
    };
}

export class MessagePayload {
    constructor() {
        this.content = [];
    }

    addText(text, role) {
        this.content.push({
            role: role || 'user',
            content: text,
        });
    }

    addTextWithImage(text, imageUrl, role) {
        this.content.push({
            role: role || 'user',
            content: [
                {
                    type: 'input_text',
                    text: text,
                },
                {
                    type: 'input_image',
                    image_url: imageUrl,
                },
            ],
        });
    }

    output() {
        return this.content;
    }
}

// Server-side utility to generate images using OpenAI GPT-Image-1
async function generateImageWithOpenAI(prompt, options = {}) {
    try {
        const openaiClient = getOpenAIClient();

        const generateOptions = {
            prompt: prompt,
            model: options.model || DEFAULT_GENERATION_MODEL,
            size: options.size || DEFAULT_GENERATION_SIZE,
            quality: options.quality || DEFAULT_QUALITY,
            output_format: 'png', // Always return base64
            n: options.n || DEFAULT_N,
            moderation: DEFAULT_MODERATION,
            ...(options.output_format && {
                output_format: options.output_format,
            }),
        };
        console.log('Generating image with options:', generateOptions);

        const result = await openaiClient.images.generate(generateOptions);

        // Handle multiple images if n > 1
        const images = result.data.map((item) => ({
            imageBase64: item.b64_json,
            revisedPrompt: item.revised_prompt || prompt,
        }));

        // Simplified response format
        return {
            success: true,
            data: {
                images: images,
                // For backward compatibility, keep single image format
                imageBase64: images[0].imageBase64,
                revisedPrompt: images[0].revisedPrompt,
                format: options.output_format || DEFAULT_OUTPUT_FORMAT,
                created: result.created,
            },
        };
    } catch (error) {
        const transformedError = transformError(error);
        return {
            success: false,
            error: transformedError.error,
            message: transformedError.message,
        };
    }
}

// Server-side utility to edit multiple images using OpenAI
// Assumes all images are PNG format File objects
async function editImagesWithOpenAI(images, mask, prompt, options = {}) {
    try {
        const openaiClient = getOpenAIClient();

        // Always pass the images array directly to OpenAI API
        const editOptions = {
            image: images,
            prompt: prompt,
            model: options.model || DEFAULT_GENERATION_MODEL,
            size: options.size || DEFAULT_GENERATION_SIZE,
            quality: options.quality || DEFAULT_QUALITY,
            output_format: 'png', // Always return base64
            n: options.n || DEFAULT_N,
            moderation: options.moderation || DEFAULT_MODERATION,
            ...(options.user && { user: options.user }),
        };
        console.log('Generating image with options:', editOptions);

        // Add mask if provided
        if (mask) {
            editOptions.mask = mask;
        }

        const result = await openaiClient.images.edit(editOptions);

        // Handle multiple images if n > 1
        const resultImages = result.data.map((item) => ({
            imageBase64: item.b64_json,
            revisedPrompt: item.revised_prompt || prompt,
        }));

        // Simplified response format
        return {
            success: true,
            data: {
                images: resultImages,
                // For backward compatibility, keep single image format
                imageBase64: resultImages[0].imageBase64,
                revisedPrompt: resultImages[0].revisedPrompt,
                format: options.output_format || DEFAULT_OUTPUT_FORMAT,
                created: result.created,
            },
        };
    } catch (error) {
        const transformedError = transformError(error);
        return {
            success: false,
            error: transformedError.error,
            message: transformedError.message,
        };
    }
}

// Export server-side utilities
export const openaiClient = {
    // Core functions
    generateImageWithOpenAI,
    editImagesWithOpenAI,

    // Helper utilities
    transformError,
};
