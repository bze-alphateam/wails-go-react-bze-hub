package chain

import (
	"context"
	"encoding/json"
	"fmt"

	clienttx "github.com/cosmos/cosmos-sdk/client/tx"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	txtypes "github.com/cosmos/cosmos-sdk/types/tx"
	signing "github.com/cosmos/cosmos-sdk/types/tx/signing"
	authsigning "github.com/cosmos/cosmos-sdk/x/auth/signing"
)

// DecodeMsgsJSON decodes a JSON array of protobuf messages — each an object with
// an "@type" field (e.g. {"@type":"/cosmos.staking.v1beta1.MsgDelegate", ...}) —
// into sdk.Msg values using the interface registry. The message types must be
// registered in NewClient.
func (c *Client) DecodeMsgsJSON(msgsJSON string) ([]sdk.Msg, error) {
	var raws []json.RawMessage
	if err := json.Unmarshal([]byte(msgsJSON), &raws); err != nil {
		return nil, fmt.Errorf("parse messages array: %w", err)
	}
	if len(raws) == 0 {
		return nil, fmt.Errorf("no messages to sign")
	}

	msgs := make([]sdk.Msg, 0, len(raws))
	for i, raw := range raws {
		var msg sdk.Msg
		if err := c.Cdc.UnmarshalInterfaceJSON(raw, &msg); err != nil {
			return nil, fmt.Errorf("decode message %d: %w", i, err)
		}
		msgs = append(msgs, msg)
	}
	return msgs, nil
}

// SimulateGas runs the messages through the chain's tx simulation and returns the
// estimated gas used. The caller applies a safety multiplier on top. A signed tx
// is built (with zero gas/fee) because the BZE ante handler inspects the signer
// info and sequence even in simulation; the signature itself is not verified.
func (c *Client) SimulateGas(
	msgs []sdk.Msg,
	privKey cryptotypes.PrivKey,
	chainID string,
	accountNumber uint64,
	sequence uint64,
	memo string,
) (uint64, error) {
	txBytes, err := c.BuildSignedTxBytes(msgs, privKey, chainID, accountNumber, sequence, sdk.NewCoins(), 0, memo)
	if err != nil {
		return 0, fmt.Errorf("build sim tx: %w", err)
	}

	conn, err := c.GetConnection()
	if err != nil {
		return 0, err
	}
	resp, err := txtypes.NewServiceClient(conn).Simulate(context.Background(), &txtypes.SimulateRequest{
		TxBytes: txBytes,
	})
	if err != nil {
		return 0, err
	}
	if resp.GasInfo == nil {
		return 0, fmt.Errorf("simulation returned no gas info")
	}
	return resp.GasInfo.GasUsed, nil
}

// BuildSignedTxBytes builds a transaction from the given messages, signs it with
// SIGN_MODE_DIRECT using privKey, and returns the protobuf-encoded tx bytes
// (ready to be base64-encoded for the /cosmos/tx/v1beta1/txs endpoint).
func (c *Client) BuildSignedTxBytes(
	msgs []sdk.Msg,
	privKey cryptotypes.PrivKey,
	chainID string,
	accountNumber uint64,
	sequence uint64,
	fee sdk.Coins,
	gasLimit uint64,
	memo string,
) ([]byte, error) {
	txBuilder := c.TxConfig.NewTxBuilder()
	if err := txBuilder.SetMsgs(msgs...); err != nil {
		return nil, fmt.Errorf("set msgs: %w", err)
	}
	txBuilder.SetGasLimit(gasLimit)
	txBuilder.SetFeeAmount(fee)
	txBuilder.SetMemo(memo)

	pubKey := privKey.PubKey()
	signMode := signing.SignMode_SIGN_MODE_DIRECT

	// Round 1: set an empty signature so SignerInfo (pubkey + mode + sequence) is
	// included in auth_info before the sign bytes are computed.
	if err := txBuilder.SetSignatures(signing.SignatureV2{
		PubKey:   pubKey,
		Data:     &signing.SingleSignatureData{SignMode: signMode},
		Sequence: sequence,
	}); err != nil {
		return nil, fmt.Errorf("set empty signature: %w", err)
	}

	signerData := authsigning.SignerData{
		ChainID:       chainID,
		AccountNumber: accountNumber,
		Sequence:      sequence,
		PubKey:        pubKey,
		Address:       sdk.AccAddress(pubKey.Address()).String(),
	}

	// Round 2: compute the DIRECT sign bytes from the current tx and sign them.
	sig, err := clienttx.SignWithPrivKey(
		context.Background(),
		signMode,
		signerData,
		txBuilder,
		privKey,
		c.TxConfig,
		sequence,
	)
	if err != nil {
		return nil, fmt.Errorf("sign: %w", err)
	}
	if err := txBuilder.SetSignatures(sig); err != nil {
		return nil, fmt.Errorf("set signature: %w", err)
	}

	return c.TxConfig.TxEncoder()(txBuilder.GetTx())
}
