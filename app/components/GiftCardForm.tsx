'use client';

import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { useWallets, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import axios from 'axios';
// Импорты SVG генераторов (пример)
import { giftCard_Pink } from './svg/giftCard_Pink.js';
import { giftCard_Blue } from './svg/giftCard_Blue.js';
import { giftCard_Green } from './svg/giftCard_Green.js';

const PINATA_API_KEY = process.env.NEXT_PUBLIC_PINATA_API_KEY || '';
const PINATA_SECRET_API_KEY = process.env.NEXT_PUBLIC_PINATA_SECRET_API_KEY || '';

const cardDesigns = [
  { name: 'Pink', generator: giftCard_Pink },
  { name: 'Blue', generator: giftCard_Blue },
  { name: 'Green', generator: giftCard_Green },
];

function isValidSuiAddress(address: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

async function getCoinsViaFetch(address: string, coinType: string) {
  const response = await fetch('https://sui-rpc.publicnode.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getCoins',
      params: [address, coinType],
    }),
  });
  const data = await response.json();
  return data.result?.data || [];
}

export default function GiftCardForm() {
  const wallets = useWallets();
  const signAndExecuteTransaction = useSignAndExecuteTransaction();
  const currentWallet = wallets.length > 0 ? wallets[0] : null;
  const [activeTab, setActiveTab] = useState<'create' | 'redeem'>('create');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [tokenType, setTokenType] = useState<'USDC' | 'USDT' | 'SUI'>('USDC');
  const [selectedDesign, setSelectedDesign] = useState(cardDesigns[0]);
  const [svgPreview, setSvgPreview] = useState('');

  // Обновляем предпросмотр при изменении amount, дизайна или токена
  useEffect(() => {
    if (amount && Number(amount) > 0) {
      const svgString = selectedDesign.generator(Number(amount), tokenType);
      const encoded = `data:image/svg+xml;base64,${btoa(svgString)}`;
      setSvgPreview(encoded);
    } else {
      setSvgPreview('');
    }
  }, [amount, selectedDesign, tokenType]);

  async function uploadSVGAndMetadataToPinata({ amount, serviceName }: { amount: number; serviceName: string }) {
    try {
      toast.success('Uploading SVG to Pinata...');
      const svgString = selectedDesign.generator(amount, tokenType);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
      const svgForm = new FormData();
      svgForm.append('file', svgBlob, 'image.svg');

      const svgRes = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', svgForm, {
        maxContentLength: Infinity,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${svgForm._boundary || 'boundary'}`,
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET_API_KEY,
        },
      });

      const svgHash = svgRes.data.IpfsHash;
      const svgUrl = `https://gateway.pinata.cloud/ipfs/${svgHash}`;

      toast.success('Uploading metadata to Pinata...');

      const metadataObj = {
        name: `Gift Card $${amount}`,
        description: `Gift card for $${amount}`,
        image: svgUrl,
        attributes: [
          { trait_type: 'Amount', value: amount },
          { trait_type: 'Service', value: serviceName },
          { trait_type: 'Design', value: selectedDesign.name },
          { trait_type: 'Token', value: tokenType },
        ],
      };

      const metadataRes = await axios.post(
        'https://api.pinata.cloud/pinning/pinJSONToIPFS',
        metadataObj,
        {
          headers: {
            pinata_api_key: PINATA_API_KEY,
            pinata_secret_api_key: PINATA_SECRET_API_KEY,
          },
        }
      );

      const metadataHash = metadataRes.data.IpfsHash;
      return `https://gateway.pinata.cloud/ipfs/${metadataHash}`;
    } catch (e: any) {
      toast.error('Error uploading to Pinata: ' + e.message);
      throw e;
    }
  }

  async function getUserCoinObjectId(address: string, coinType: string): Promise<string | null> {
    const coins = await getCoinsViaFetch(address, coinType);
    if (!coins || coins.length === 0) {
      return null;
    }
    return coins[0].coinObjectId;
  }

  async function createGiftCard() {
    if (!currentWallet) {
      toast.error('Connect your wallet first');
      return;
    }

    const userAddress = currentWallet.accounts?.[0]?.address;
    if (!userAddress) {
      toast.error('Wallet address not available');
      return;
    }

    if (!amount || !recipient) {
      toast.error('Please enter amount and recipient');
      return;
    }

    if (typeof recipient !== 'string' || !isValidSuiAddress(recipient)) {
      toast.error('Recipient address not valid');
      return;
    }

    try {
      const metadataUrl = await uploadSVGAndMetadataToPinata({
        amount: Number(amount),
        serviceName: 'Sendly Gift',
      });

      const coinTypeMap = {
        USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
        USDT: '0x...USDT_PACKAGE_ID::usdt::USDT',
        SUI: '0x2::sui::SUI',
      };
      const coinType = coinTypeMap[tokenType];
      const coinObjectId = await getUserCoinObjectId(userAddress, coinType);
      if (!coinObjectId) {
        toast.error(`No ${tokenType} coin found in your wallet`);
        return;
      }

      const collectionObjectId = '0x...'; // Вставьте сюда ваш ID коллекции

      const tx = new TransactionBlock();

      const amountInt = Math.floor(Number(amount) * 100);

      tx.moveCall({
        target: '0x3ff96881372987062677120bdd2460561ae2f2ba90fa8a0aeb397144508e65c9::gift_card::create_gift_card_usdc',
        arguments: [
          tx.object(collectionObjectId),
          tx.pure(recipient, 'address'),
          tx.object(coinObjectId),
          tx.pure(new TextEncoder().encode(metadataUrl), 'vector<u8>'),
          tx.pure(new TextEncoder().encode(message), 'vector<u8>'),
        ],
      });

      const result = await signAndExecuteTransaction({
        transactionBlock: tx,
      });

      toast.success('Gift card created! Tx digest: ' + result.digest);
    } catch (e: any) {
      toast.error('Failed to create gift card: ' + e.message);
    }
  }

  if (!currentWallet) {
    return (
      <button onClick={() => {
        // Здесь вызовите метод подключения кошелька, например walletSelector.open()
        // В зависимости от вашей реализации
        alert('Please connect your wallet');
      }}>
        Connect Wallet
      </button>
    );
  }

  return (
    <main className="pt-28 max-w-xl mx-auto bg-white rounded-3xl shadow-2xl p-8">
      <div className="flex justify-center mb-6 space-x-4">
        <button
          className={`px-6 py-3 rounded-t-2xl font-bold text-lg transition ${
            activeTab === 'create' ? 'bg-indigo-500 text-white shadow' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
          }`}
          onClick={() => setActiveTab('create')}
        >
          Create Gift Card
        </button>
        <button
          className={`px-6 py-3 rounded-t-2xl font-bold text-lg transition ${
            activeTab === 'redeem' ? 'bg-indigo-500 text-white shadow' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
          }`}
          onClick={() => setActiveTab('redeem')}
        >
          Redeem Gift Card
        </button>
      </div>

      {activeTab === 'create' && (
        <>
          {/* Выбор дизайна */}
          <div className="mb-4">
            <label className="block font-semibold mb-2 text-indigo-700">Card design:</label>
            <div className="flex gap-4">
              {cardDesigns.map((design) => (
                <button
                  key={design.name}
                  type="button"
                  className={`px-4 py-2 rounded-lg border-2 font-medium transition ${
                    selectedDesign.name === design.name
                      ? 'border-indigo-500 bg-indigo-100'
                      : 'border-gray-200 bg-white hover:border-indigo-300'
                  }`}
                  onClick={() => setSelectedDesign(design)}
                >
                  {design.name}
                </button>
              ))}
            </div>
          </div>

          {/* Выбор токена */}
          <div className="flex gap-8 items-center mb-3">
            <label className="font-medium flex items-center">
              <input
                type="radio"
                value="USDC"
                checked={tokenType === 'USDC'}
                onChange={() => setTokenType('USDC')}
                className="mr-2 accent-indigo-500"
              />
              USDC
            </label>
            <label className="font-medium flex items-center">
              <input
                type="radio"
                value="USDT"
                checked={tokenType === 'USDT'}
                onChange={() => setTokenType('USDT')}
                className="mr-2 accent-indigo-500"
              />
              USDT
            </label>
            <label className="font-medium flex items-center">
              <input
                type="radio"
                value="SUI"
                checked={tokenType === 'SUI'}
                onChange={() => setTokenType('SUI')}
                className="mr-2 accent-indigo-500"
              />
              SUI
            </label>
          </div>

          {/* Предпросмотр */}
          {svgPreview && (
            <div className="mb-6 flex justify-center">
              <img src={svgPreview} alt="Gift card preview" className="rounded-xl shadow-lg" />
            </div>
          )}

          {/* Остальные поля */}
          <input
            type="text"
            placeholder="Recipient address (0x...)"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-indigo-200 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
          />
          <input
            type="number"
            placeholder="Amount (for example, 10)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-indigo-200 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
          />
          <input
            type="text"
            placeholder="Message (for example, Happy Birthday!)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-indigo-200 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
          />
          <button
            onClick={createGiftCard}
            className="w-full py-3 bg-gradient-to-r from-indigo-500 to-indigo-400 text-white rounded-xl font-bold text-lg shadow hover:from-indigo-600 hover:to-indigo-500 transition"
          >
            Create Card
          </button>
        </>
      )}

      {activeTab === 'redeem' && (
        <div>
          <input
            type="text"
            placeholder="Token ID"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-indigo-200 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
          />
          <button
            onClick={() => {
              toast('Redeem functionality not implemented yet');
            }}
            className="w-full py-3 bg-gradient-to-r from-green-500 to-green-400 text-white rounded-xl font-bold text-lg shadow hover:from-green-600 hover:to-green-500 transition"
          >
            Redeem Card
          </button>
        </div>
      )}
    </main>
  );
}