import { useState } from "react";
import { VStack, Heading, Text, Input, Button, Box, Field, HStack } from "@chakra-ui/react";

interface Props {
  needsPassword: boolean;
  onSubmit: (label: string, password: string) => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}

export function StepCreate({ needsPassword, onSubmit, onBack, loading, error }: Props) {
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordsMatch = !needsPassword || password === confirmPassword;
  const passwordLong = !needsPassword || password.length >= 8;
  const canSubmit = label.trim().length > 0 && passwordsMatch && passwordLong && !loading;

  return (
    <VStack gap="5">
      <Heading size="lg">Create Your Wallet</Heading>

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
            <Field.HelperText>
              This password encrypts your recovery phrase on this device.
            </Field.HelperText>
          </Field.Root>

          <Field.Root invalid={password.length > 0 && confirmPassword.length > 0 && !passwordsMatch}>
            <Field.Label>Confirm password</Field.Label>
            <Input
              type="password"
              placeholder="Repeat password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {!passwordsMatch && password.length > 0 && confirmPassword.length > 0 && (
              <Field.ErrorText>Passwords do not match</Field.ErrorText>
            )}
          </Field.Root>
        </>
      )}

      {!needsPassword && (
        <Box p="3" bg="bg.subtle" borderRadius="md" w="full">
          <Text fontSize="sm" color="fg.muted">
            Your recovery phrase will be stored in the macOS Keychain,
            protected by Touch ID or your system password.
          </Text>
        </Box>
      )}

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
          onClick={() => onSubmit(label.trim(), password)}
        >
          Continue
        </Button>
      </HStack>
    </VStack>
  );
}
