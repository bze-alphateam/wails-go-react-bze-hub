import { useState } from "react";
import { VStack, Heading, Text, Input, Button, HStack, Field } from "@chakra-ui/react";

interface Props {
  indices: number[];
  onVerify: (answers: string[]) => boolean;
  onNext: () => void;
  onBack: () => void;
}

export function StepVerifyPhrase({ indices, onVerify, onNext, onBack }: Props) {
  const [answers, setAnswers] = useState<string[]>(indices.map(() => ""));
  const [error, setError] = useState(false);

  const allFilled = answers.every((a) => a.trim().length > 0);

  const handleVerify = () => {
    const trimmed = answers.map((a) => a.trim().toLowerCase());
    if (onVerify(trimmed)) {
      setError(false);
      onNext();
    } else {
      setError(true);
    }
  };

  return (
    <VStack gap="5">
      <Heading size="lg">Confirm Your Recovery Phrase</Heading>

      <Text fontSize="sm" color="fg.muted" textAlign="center">
        Enter the following words from your recovery phrase to verify your backup.
      </Text>

      <VStack gap="3" w="full">
        {indices.map((wordIndex, i) => (
          <Field.Root key={wordIndex} invalid={error}>
            <Field.Label>Word #{wordIndex + 1}</Field.Label>
            <Input
              placeholder={`Enter word #${wordIndex + 1}`}
              value={answers[i]}
              onChange={(e) => {
                const newAnswers = [...answers];
                newAnswers[i] = e.target.value;
                setAnswers(newAnswers);
                setError(false);
              }}
            />
          </Field.Root>
        ))}
      </VStack>

      {error && (
        <Text color="red.500" fontSize="sm">
          One or more words are incorrect. Please check your backup and try again.
        </Text>
      )}

      <HStack w="full" gap="3" justify="space-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          colorPalette="teal"
          disabled={!allFilled}
          onClick={handleVerify}
        >
          Confirm
        </Button>
      </HStack>
    </VStack>
  );
}
