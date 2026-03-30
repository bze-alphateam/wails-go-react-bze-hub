import { useState, useEffect, useRef } from "react";
import {
  Box, HStack, VStack, Text, Button, IconButton,
  Portal, Input, Textarea, NativeSelect,
} from "@chakra-ui/react";
import {
  LuChevronDown, LuCopy, LuCheck, LuPlus, LuDownload,
  LuKey, LuFileOutput, LuKeyRound, LuWallet,
} from "react-icons/lu";
import {
  GetAccounts, SwitchAccount, DeriveNewAddress,
  ImportMnemonic, ImportPrivateKey, ExportMnemonic, ExportPrivateKey,
} from "../../wailsjs/go/main/App";

interface Account {
  label: string;
  bech32Address: string;
  hdPath: string;
  mnemonicLabel: string;
  isImportedPK: boolean;
}

interface MnemonicRef {
  label: string;
}

interface WalletMenuProps {
  activeLabel: string;
  activeAddress: string;
  onAccountChanged: () => void;
}

export function WalletMenu({ activeLabel, activeAddress, onAccountChanged }: WalletMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mnemonics, setMnemonics] = useState<MnemonicRef[]>([]);
  const [modal, setModal] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const truncated = activeAddress.length > 16
    ? `${activeAddress.slice(0, 8)}...${activeAddress.slice(-4)}`
    : activeAddress;

  useEffect(() => {
    if (open) loadAccounts();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function loadAccounts() {
    try {
      const data = await GetAccounts();
      setAccounts(data.accounts as Account[] || []);
      setMnemonics(data.mnemonics as MnemonicRef[] || []);
    } catch (e) {
      console.error("load accounts:", e);
    }
  }

  async function handleSwitch(address: string) {
    try {
      await SwitchAccount(address);
      onAccountChanged();
      setOpen(false);
    } catch (e) {
      console.error("switch account:", e);
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Box position="relative" ref={menuRef}>
      {/* Trigger */}
      <HStack
        gap="0"
        fontSize="xs"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
      >
        {/* Wallet name — opens dropdown */}
        <HStack
          gap="1.5"
          px="3"
          py="1.5"
          cursor="pointer"
          _hover={{ bg: "bg.subtle" }}
          borderRightWidth="1px"
          borderColor="border"
          borderTopLeftRadius="md"
          borderBottomLeftRadius="md"
          onClick={() => setOpen(!open)}
        >
          {LuWallet({}) as React.ReactNode}
          <Text fontWeight="medium">{activeLabel}</Text>
          {LuChevronDown({}) as React.ReactNode}
        </HStack>

        {/* Address — click to copy */}
        <HStack
          gap="1.5"
          px="3"
          py="1.5"
          cursor="pointer"
          _hover={{ bg: "bg.subtle" }}
          borderTopRightRadius="md"
          borderBottomRightRadius="md"
          onClick={handleCopy}
        >
          <Text fontFamily="mono" color="fg.muted">{truncated}</Text>
          <Box color={copied ? "green.500" : "fg.muted"}>
            {copied ? LuCheck({}) as React.ReactNode : LuCopy({}) as React.ReactNode}
          </Box>
        </HStack>
      </HStack>

      {/* Dropdown */}
      {open && (
        <Box
          position="absolute"
          right="0"
          top="100%"
          mt="1"
          w="320px"
          bg="bg.panel"
          borderWidth="1px"
          borderColor="border"
          borderRadius="lg"
          shadow="lg"
          zIndex="dropdown"
          p="2"
        >
          <VStack gap="1" align="stretch" maxH="250px" overflowY="auto">
            <Text fontSize="2xs" fontWeight="semibold" color="fg.muted" px="2" pt="1">
              ACCOUNTS
            </Text>
            {accounts.map((acc) => (
              <HStack
                key={acc.bech32Address}
                px="2"
                py="1.5"
                borderRadius="md"
                cursor="pointer"
                bg={acc.bech32Address === activeAddress ? "teal.50" : "transparent"}
                _dark={acc.bech32Address === activeAddress ? { bg: "teal.900/20" } : {}}
                _hover={{ bg: acc.bech32Address === activeAddress ? undefined : "bg.subtle" }}
                onClick={() => handleSwitch(acc.bech32Address)}
              >
                <Box flex="1" minW="0">
                  <Text fontSize="xs" fontWeight="medium" truncate>
                    {acc.label}
                  </Text>
                  <Text fontSize="2xs" fontFamily="mono" color="fg.muted" truncate>
                    {acc.bech32Address}
                  </Text>
                </Box>
                {acc.bech32Address === activeAddress && (
                  <Box w="2" h="2" borderRadius="full" bg="teal.500" flexShrink={0} />
                )}
              </HStack>
            ))}
          </VStack>

          <Box my="2" borderTopWidth="1px" borderColor="border" />

          <VStack gap="0" align="stretch">
            <MenuAction icon={LuPlus({}) as React.ReactNode} label="New Address" onClick={() => { setOpen(false); setModal("newAddress"); }} />
            <MenuAction icon={LuDownload({}) as React.ReactNode} label="Import Mnemonic" onClick={() => { setOpen(false); setModal("importMnemonic"); }} />
            <MenuAction icon={LuKey({}) as React.ReactNode} label="Import Private Key" onClick={() => { setOpen(false); setModal("importKey"); }} />

            <Box my="1" borderTopWidth="1px" borderColor="border" />

            <MenuAction icon={LuFileOutput({}) as React.ReactNode} label="Export Mnemonic" onClick={() => { setOpen(false); setModal("exportMnemonic"); }} />
            <MenuAction icon={LuKeyRound({}) as React.ReactNode} label="Export Private Key" onClick={() => { setOpen(false); setModal("exportKey"); }} />
          </VStack>
        </Box>
      )}

      {/* Modals */}
      {modal === "newAddress" && (
        <SimpleModal title="New Address" onClose={() => setModal(null)}>
          <NewAddressForm mnemonics={mnemonics} onCreated={() => { setModal(null); onAccountChanged(); }} />
        </SimpleModal>
      )}
      {modal === "importMnemonic" && (
        <SimpleModal title="Import Mnemonic" onClose={() => setModal(null)}>
          <ImportMnemonicForm onImported={() => { setModal(null); onAccountChanged(); }} />
        </SimpleModal>
      )}
      {modal === "importKey" && (
        <SimpleModal title="Import Private Key" onClose={() => setModal(null)}>
          <ImportKeyForm onImported={() => { setModal(null); onAccountChanged(); }} />
        </SimpleModal>
      )}
      {modal === "exportMnemonic" && (
        <SimpleModal title="Export Mnemonic" onClose={() => setModal(null)}>
          <ExportMnemonicForm mnemonics={mnemonics} />
        </SimpleModal>
      )}
      {modal === "exportKey" && (
        <SimpleModal title="Export Private Key" onClose={() => setModal(null)}>
          <ExportKeyForm accounts={accounts} />
        </SimpleModal>
      )}
    </Box>
  );
}

// --- Helpers ---

function MenuAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <HStack px="2" py="1.5" borderRadius="md" cursor="pointer" _hover={{ bg: "bg.subtle" }} onClick={onClick} fontSize="xs" gap="2">
      {icon}
      <Text>{label}</Text>
    </HStack>
  );
}

function SimpleModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Portal>
      <Box position="fixed" top="0" left="0" right="0" bottom="0" bg="blackAlpha.600" zIndex="modal" display="flex" alignItems="center" justifyContent="center" onClick={onClose}>
        <Box bg="bg.panel" borderRadius="xl" p="6" w="420px" maxH="80vh" overflowY="auto" shadow="xl" onClick={(e) => e.stopPropagation()}>
          <HStack justify="space-between" mb="4">
            <Text fontWeight="semibold" fontSize="lg">{title}</Text>
            <Button size="xs" variant="ghost" onClick={onClose}>X</Button>
          </HStack>
          {children}
        </Box>
      </Box>
    </Portal>
  );
}

// --- Forms ---

function NewAddressForm({ mnemonics, onCreated }: { mnemonics: MnemonicRef[]; onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [selectedMnemonic, setSelectedMnemonic] = useState(mnemonics[0]?.label || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (mnemonics.length === 0) {
    return <Text fontSize="sm" color="fg.muted">No mnemonics available. Import one first.</Text>;
  }

  return (
    <VStack gap="3" align="stretch">
      <Box>
        <Text fontSize="sm" fontWeight="medium" mb="1">Account name</Text>
        <Input size="sm" placeholder="Trading account" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Box>
      {mnemonics.length > 1 && (
        <Box>
          <Text fontSize="sm" fontWeight="medium" mb="1">Derive from mnemonic</Text>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field value={selectedMnemonic} onChange={(e) => setSelectedMnemonic(e.target.value)}>
              {mnemonics.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)}
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Box>
      )}
      {error && <Text fontSize="sm" color="red.500">{error}</Text>}
      <Button colorPalette="teal" size="sm" disabled={!label.trim() || loading} loading={loading} onClick={async () => {
        setLoading(true); setError("");
        try { await DeriveNewAddress(selectedMnemonic, label, ""); onCreated(); }
        catch (e: any) { setError(e?.message || String(e)); }
        finally { setLoading(false); }
      }}>Create</Button>
    </VStack>
  );
}

function ImportMnemonicForm({ onImported }: { onImported: () => void }) {
  const [label, setLabel] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const valid = wordCount === 12 || wordCount === 24;

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const cleaned = e.clipboardData.getData("text").replace(/\d+\.\s*/g, " ").replace(/[\n\r\t]+/g, " ").replace(/\s+/g, " ").trim();
    setMnemonic(cleaned);
  };

  return (
    <VStack gap="3" align="stretch">
      <Box>
        <Text fontSize="sm" fontWeight="medium" mb="1">Label</Text>
        <Input size="sm" placeholder="My other wallet" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Box>
      <Box>
        <Text fontSize="sm" fontWeight="medium" mb="1">Mnemonic (12 or 24 words)</Text>
        <Textarea size="sm" placeholder="Enter or paste your mnemonic..." value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} onPaste={handlePaste as any} rows={3} />
        {mnemonic.length > 0 && !valid && (
          <Text fontSize="xs" color="red.500" mt="1">Must be 12 or 24 words (currently {wordCount})</Text>
        )}
      </Box>
      {error && <Text fontSize="sm" color="red.500">{error}</Text>}
      <Button colorPalette="teal" size="sm" disabled={!label.trim() || !valid || loading} loading={loading} onClick={async () => {
        setLoading(true); setError("");
        try { await ImportMnemonic(label, mnemonic.trim(), ""); onImported(); }
        catch (e: any) { setError(e?.message || String(e)); }
        finally { setLoading(false); }
      }}>Import</Button>
    </VStack>
  );
}

function ImportKeyForm({ onImported }: { onImported: () => void }) {
  const [label, setLabel] = useState("");
  const [pk, setPk] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const validHex = /^[0-9a-fA-F]{64}$/.test(pk.trim());

  return (
    <VStack gap="3" align="stretch">
      <Box>
        <Text fontSize="sm" fontWeight="medium" mb="1">Label</Text>
        <Input size="sm" placeholder="Old wallet" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Box>
      <Box>
        <Text fontSize="sm" fontWeight="medium" mb="1">Private key (64 hex characters)</Text>
        <Input size="sm" fontFamily="mono" fontSize="xs" placeholder="Enter hex-encoded private key..." value={pk} onChange={(e) => setPk(e.target.value)} />
        {pk.length > 0 && !validHex && (
          <Text fontSize="xs" color="red.500" mt="1">Must be 64 hex characters (32 bytes)</Text>
        )}
      </Box>
      {error && <Text fontSize="sm" color="red.500">{error}</Text>}
      <Button colorPalette="teal" size="sm" disabled={!label.trim() || !validHex || loading} loading={loading} onClick={async () => {
        setLoading(true); setError("");
        try { await ImportPrivateKey(label, pk.trim(), ""); onImported(); }
        catch (e: any) { setError(e?.message || String(e)); }
        finally { setLoading(false); }
      }}>Import</Button>
    </VStack>
  );
}

function ExportMnemonicForm({ mnemonics }: { mnemonics: MnemonicRef[] }) {
  const [selected, setSelected] = useState(mnemonics[0]?.label || "");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (phrase === null) return;
    const timer = setInterval(() => {
      setCountdown((c) => { if (c <= 1) { setPhrase(null); return 60; } return c - 1; });
    }, 1000);
    return () => clearInterval(timer);
  }, [phrase]);

  if (mnemonics.length === 0) {
    return <Text fontSize="sm" color="fg.muted">No mnemonics to export.</Text>;
  }

  if (phrase) {
    return (
      <VStack gap="3" align="stretch">
        <Box p="3" bg="bg.subtle" borderRadius="md" fontSize="sm" fontFamily="mono" lineHeight="tall" wordBreak="break-word">
          {phrase}
        </Box>
        <HStack justify="space-between">
          <Button size="sm" variant="outline" onClick={async () => {
            await navigator.clipboard.writeText(phrase);
            setCopied(true); setTimeout(() => setCopied(false), 1500);
          }}>{copied ? "Copied!" : "Copy to clipboard"}</Button>
          <Text fontSize="xs" color="fg.muted">Auto-hide in {countdown}s</Text>
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack gap="3" align="stretch">
      <Text fontSize="sm" color="red.500" fontWeight="semibold">Anyone with this mnemonic can access your funds. Never share it.</Text>
      {mnemonics.length > 1 && (
        <Box>
          <Text fontSize="sm" fontWeight="medium" mb="1">Select mnemonic</Text>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field value={selected} onChange={(e) => setSelected(e.target.value)}>
              {mnemonics.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)}
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Box>
      )}
      {error && <Text fontSize="sm" color="red.500">{error}</Text>}
      <Button colorPalette="teal" size="sm" loading={loading} onClick={async () => {
        setLoading(true); setError("");
        try { const r = await ExportMnemonic(selected, ""); setPhrase(r); setCountdown(60); }
        catch (e: any) { setError(e?.message || String(e)); }
        finally { setLoading(false); }
      }}>Reveal Mnemonic</Button>
    </VStack>
  );
}

function ExportKeyForm({ accounts }: { accounts: Account[] }) {
  const [selected, setSelected] = useState(accounts[0]?.bech32Address || "");
  const [pk, setPk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(60);

  const selectedAcc = accounts.find((a) => a.bech32Address === selected);

  useEffect(() => {
    if (pk === null) return;
    const timer = setInterval(() => {
      setCountdown((c) => { if (c <= 1) { setPk(null); return 60; } return c - 1; });
    }, 1000);
    return () => clearInterval(timer);
  }, [pk]);

  if (accounts.length === 0) {
    return <Text fontSize="sm" color="fg.muted">No accounts to export.</Text>;
  }

  if (pk) {
    return (
      <VStack gap="3" align="stretch">
        <Box p="3" bg="bg.subtle" borderRadius="md" fontSize="xs" fontFamily="mono" lineHeight="tall" wordBreak="break-all">
          {pk}
        </Box>
        <HStack justify="space-between">
          <Button size="sm" variant="outline" onClick={async () => {
            await navigator.clipboard.writeText(pk);
            setCopied(true); setTimeout(() => setCopied(false), 1500);
          }}>{copied ? "Copied!" : "Copy to clipboard"}</Button>
          <Text fontSize="xs" color="fg.muted">Auto-hide in {countdown}s</Text>
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack gap="3" align="stretch">
      <Text fontSize="sm" color="red.500" fontWeight="semibold">Anyone with this key can access your funds. Never share it.</Text>
      {accounts.length > 1 && (
        <Box>
          <Text fontSize="sm" fontWeight="medium" mb="1">Select account</Text>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field value={selected} onChange={(e) => setSelected(e.target.value)}>
              {accounts.map((a) => <option key={a.bech32Address} value={a.bech32Address}>{a.label}</option>)}
            </NativeSelect.Field>
          </NativeSelect.Root>
        </Box>
      )}
      {selectedAcc && (
        <Text fontSize="xs" fontFamily="mono" color="fg.muted">{selectedAcc.bech32Address}</Text>
      )}
      {error && <Text fontSize="sm" color="red.500">{error}</Text>}
      <Button colorPalette="teal" size="sm" loading={loading} onClick={async () => {
        setLoading(true); setError("");
        try { const r = await ExportPrivateKey(selected, ""); setPk(r); setCountdown(60); }
        catch (e: any) { setError(e?.message || String(e)); }
        finally { setLoading(false); }
      }}>Reveal Private Key</Button>
    </VStack>
  );
}
