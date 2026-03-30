package crypto

import (
	"bytes"
	"testing"
)

func TestEncryptDecrypt(t *testing.T) {
	password := "testpassword123"
	plaintext := []byte("this is a secret mnemonic phrase")

	encrypted, err := EncryptWithPassword(plaintext, password)
	if err != nil {
		t.Fatalf("EncryptWithPassword failed: %v", err)
	}

	if bytes.Equal(encrypted, plaintext) {
		t.Error("encrypted data should differ from plaintext")
	}

	decrypted, err := DecryptWithPassword(encrypted, password)
	if err != nil {
		t.Fatalf("DecryptWithPassword failed: %v", err)
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Errorf("decrypted data should match plaintext: got %q, want %q", decrypted, plaintext)
	}
}

func TestDecryptWrongPassword(t *testing.T) {
	plaintext := []byte("secret data")
	encrypted, _ := EncryptWithPassword(plaintext, "correct")

	_, err := DecryptWithPassword(encrypted, "wrong")
	if err == nil {
		t.Error("decrypting with wrong password should fail")
	}
}

func TestEncryptDifferentEachTime(t *testing.T) {
	plaintext := []byte("same data")
	password := "password"

	enc1, _ := EncryptWithPassword(plaintext, password)
	enc2, _ := EncryptWithPassword(plaintext, password)

	if bytes.Equal(enc1, enc2) {
		t.Error("two encryptions of the same data should produce different ciphertexts (random salt+nonce)")
	}
}

func TestSecureZero(t *testing.T) {
	data := []byte{1, 2, 3, 4, 5}
	SecureZero(data)

	for i, b := range data {
		if b != 0 {
			t.Errorf("byte at index %d should be zero, got %d", i, b)
		}
	}
}
