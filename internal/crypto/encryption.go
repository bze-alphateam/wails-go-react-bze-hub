package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"

	"golang.org/x/crypto/argon2"
)

const (
	saltLen      = 16
	argonTime    = 1
	argonMemory  = 64 * 1024 // 64 MB
	argonThreads = 4
	keyLen       = 32 // AES-256
)

// EncryptWithPassword encrypts plaintext using AES-256-GCM with an Argon2id-derived key.
// Returns: salt (16 bytes) + nonce + ciphertext + GCM tag.
func EncryptWithPassword(plaintext []byte, password string) ([]byte, error) {
	salt := make([]byte, saltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}

	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, keyLen)
	defer SecureZero(key)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	// Prepend salt
	result := make([]byte, 0, saltLen+len(ciphertext))
	result = append(result, salt...)
	result = append(result, ciphertext...)
	return result, nil
}

// DecryptWithPassword decrypts data produced by EncryptWithPassword.
func DecryptWithPassword(data []byte, password string) ([]byte, error) {
	if len(data) < saltLen {
		return nil, errors.New("data too short")
	}

	salt := data[:saltLen]
	ciphertext := data[saltLen:]

	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, keyLen)
	defer SecureZero(key)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}

	plaintext, err := gcm.Open(nil, ciphertext[:nonceSize], ciphertext[nonceSize:], nil)
	if err != nil {
		return nil, errors.New("incorrect password or corrupted data")
	}
	return plaintext, nil
}

// SecureZero overwrites a byte slice with zeros.
func SecureZero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
