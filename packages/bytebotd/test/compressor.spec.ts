import { Base64ImageCompressor } from '../src/mcp/compressor';

describe('Base64ImageCompressor', () => {
  describe('convertJpegToPng', () => {
    it('should convert JPEG base64 to PNG format', async () => {
      // Create a simple test JPEG base64 (minimal valid JPEG)
      const minimalJpegBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/AB//2Q==';

      const result = await Base64ImageCompressor.convertJpegToPng(minimalJpegBase64);

      // Verify it's a valid base64 string
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);

      // Verify it can be decoded as a buffer
      const buffer = Buffer.from(result, 'base64');
      expect(buffer.length).toBeGreaterThan(0);

      // PNG files start with specific bytes
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
      expect(buffer[2]).toBe(0x4E);
      expect(buffer[3]).toBe(0x47);
    });

    it('should handle data URL format', async () => {
      const jpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/AB//2Q==';

      const result = await Base64ImageCompressor.convertJpegToPng(jpegDataUrl);

      expect(result).toBeDefined();
      const buffer = Buffer.from(result, 'base64');
      // Should be PNG format
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
    });
  });

  describe('getBase64SizeInfo', () => {
    it('should calculate correct size information', () => {
      const testBase64 = 'SGVsbG8gV29ybGQ='; // "Hello World" in base64

      const result = Base64ImageCompressor.getBase64SizeInfo(testBase64);

      expect(result.bytes).toBe(11); // "Hello World" is 11 bytes
      expect(result.kb).toBeCloseTo(0.0107, 4);
      expect(result.mb).toBeCloseTo(0.000010, 6);
      expect(result.formatted).toBe('11 bytes');
    });
  });
});