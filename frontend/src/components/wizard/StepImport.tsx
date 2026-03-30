import { useState } from "react";
import { VStack, Heading, Text, Input, Button, Textarea, Field, HStack } from "@chakra-ui/react";

interface Props {
  needsPassword: boolean;
  onSubmit: (label: string, mnemonic: string, password: string) => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}

export function StepImport({ needsPassword, onSubmit, onBack, loading, error }: Props) {
  const [label, setLabel] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    // Clean up: remove numbered prefixes (e.g., "1. word 2. word"), extra whitespace, newlines
    const cleaned = pasted
      .replace(/\d+\.\s*/g, " ")  // Remove "1. ", "2. " etc.
      .replace(/[\n\r\t]+/g, " ") // Newlines/tabs to spaces
      .replace(/\s+/g, " ")       // Collapse multiple spaces
      .trim();
    setMnemonic(cleaned);
  };

  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const validWordCount = wordCount === 12 || wordCount === 24;
  const passwordsMatch = !needsPassword || password === confirmPassword;
  const passwordLong = !needsPassword || password.length >= 8;
  const canSubmit = label.trim().length > 0 && validWordCount && passwordsMatch && passwordLong && !loading;

  return (
    <VStack gap="5">
      <Heading size="lg">Import Your Wallet</Heading>

      <Field.Root>
        <Field.Label>Wallet name</Field.Label>
        <Input
          placeholder="My BZE Wallet"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field.Root>

      {needsPassword && (
        <>
          <Field.Root>
            <Field.Label>Password</Field.Label>
            <Input
              type="password"
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field.Root>

          <Field.Root invalid={password.length > 0 && confirmPassword.length > 0 && !passwordsMatch}>
            <Field.Label>Confirm password</Field.Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {!passwordsMatch && password.length > 0 && confirmPassword.length > 0 && (
              <Field.ErrorText>Passwords do not match</Field.ErrorText>
            )}
          </Field.Root>
        </>
      )}

      <Field.Root invalid={mnemonic.length > 0 && !validWordCount}>
        <Field.Label>Recovery phrase (12 or 24 words)</Field.Label>
        <Textarea
          placeholder="Enter or paste your recovery phrase..."
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          onPaste={handlePaste}
          rows={3}
        />
        {mnemonic.length > 0 && !validWordCount && (
          <Field.ErrorText>
            Recovery phrase must be 12 or 24 words (currently {wordCount})
          </Field.ErrorText>
        )}
      </Field.Root>

      {error && (
        <Text color="red.500" fontSize="sm">{error}</Text>
      )}

      <HStack w="full" gap="3" justify="space-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          colorPalette="teal"
          disabled={!canSubmit}
          loading={loading}
          onClick={() => onSubmit(label.trim(), mnemonic.trim(), password)}
        >
          Import
        </Button>
      </HStack>
    </VStack>
  );
}
