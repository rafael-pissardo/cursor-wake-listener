# Juarez, o mordomo do Cursor

Você fala. Ele escuta. Ele digita no Cursor. Você continua com a mão no café.

`cursor-wake-listener` é um mordomo de voz que mora na bandeja do **Windows**, atende pelo nome de **Juarez** e cola o que você falou direto no Agent do Cursor — mesmo com o projeto aberto no WSL.

Tudo roda **local**: microfone + Whisper na sua máquina. Sem conta, sem API key, sem áudio viajando para a nuvem. O Juarez é discreto.

```
    você                Juarez                       Cursor
     |                    |                             |
     |-- "juarez" ------->| (pílula azul: pode falar)   |
     |                    |                             |
     |-- "lista meus PRs">| Whisper transcreve          |
     |                    |-- Ctrl+I + cola + Enter --->|
     |                    |                             |-- trabalha
```

> Não rode isso dentro do WSL. O microfone e a janela do Cursor são do Windows — o Juarez precisa dos dois.

## Contratando o mordomo

PowerShell no Windows:

```powershell
cd $env:USERPROFILE\cursor-wake-listener
npm install
npm test
```

75 testes. Se todos passarem, ele sabe o ofício.

## Entrevista de emprego (sem microfone)

Cursor aberto, painel do Agent visível:

```powershell
npm run test-send -- "ping do wake listener"
```

Se o texto apareceu no chat, o braço direito dele funciona.

Agora peça um chat novo:

```powershell
npm run test-send -- --new-chat "ping do novo chat"
```

## Primeiro dia de trabalho

```powershell
npm start
```

Na primeira vez o Whisper (`Xenova/whisper-small`, `q8`) baixa para `models\` — vai buscar um café, leva alguns minutos.

Aí é só chamar:

- *juarez* → (pílula azul) → *lista meus PRs*
- *ok* → (pílula azul) → *roda os testes do serializer*
- *juarez* → (pílula azul) → *em um novo chat lista meus PRs abertos*

**A regra da casa:** o Juarez atende primeiro, escuta depois. Pedido na mesma frase que o nome dele é ignorado de propósito — chame, espere o azul, depois fale. Sem chamar o nome, ele finge que não ouviu (nem HUD aparece). Depois de 8s de silêncio ele volta a cochilar esperando o nome.

`Ctrl+C` demite. Ou clique direito no ícone da bandeja (canto inferior direito, às vezes escondido na setinha `^`) → **Sair**.

## A pílula azul

O HUD só aparece **depois** que você chama o nome, e conta o que está acontecendo: **Pode falar** → **Ouvindo** → **Transcrevendo** → **Enviado**. Um tom contínuo confirma que a porta abriu, estilo Alexa.

Preview sem gastar voz:

```powershell
npm run test-hud
```

Prefere silêncio visual? `"visualFeedback": false` no `config.json`.

## Mordomo invisível (só o ícone na bandeja)

```powershell
npm run tray
```

Ou dois cliques em `start-tray.vbs`. O diário dele vai para `tray.log`.

Para ele bater ponto junto com o Windows: `Win+R` → `shell:startup` → atalho para `start-tray.vbs`.

## Treinando o ouvido dele (`config.json`)

| Campo | Padrão | O que faz |
|---|---|---|
| `wakePhrases` | `juarez`, `okay`, `ok` | Nomes pelos quais ele atende. |
| `wakeFuzzyMaxDistance` | `2` | Levenshtein na wake word + um match fonético para os apelidos que o Whisper inventa (`vareis`, `jorais`). `0` desliga a tolerância. |
| `language` | `pt-BR` | Idioma da transcrição. O Whisper não separa PT-BR de PT-PT; vira `portuguese`. |
| `whisperModel` | `Xenova/whisper-small` | O modelo que se comporta bem neste PC. |
| `whisperDtype` | `q8` | Quantização. |
| `whisperDevice` | `cpu` | DirectML (`dml`) na 4060 ainda alucina com Whisper. Veja *Os fantasmas da GPU*. |
| `whisperDeviceId` | (auto) | Índice DXGI. Vazio = pega a NVIDIA, não a Intel Arc. |
| `whisperBeams` | `1` | `3` acerta mais e demora mais. |
| `openAgentHotkey` | `true` | Manda `Ctrl+I` antes de colar. |
| `newChatHotkey` | `palette` | Abre **Open New Agent Chat** via Command Palette (`Ctrl+Shift+P`) — o input do Agent engole `Ctrl+Shift+L`. |
| `newChatPhrases` | `em um novo chat`, `novo chat`, … | Se a fala tiver uma dessas, ele abre chat novo e cola o resto. |
| `submit` | `true` | Dá Enter depois de colar. |
| `micDeviceMatch` | `USB` | Escolhe o microfone cujo nome contém isso. |
| `visualFeedback` | `true` | A pílula azul. |
| `armedTimeoutMs` | `8000` | Sem pedido nesse tempo, ele volta a esperar o nome. |

Neste PC o match `USB` pega o `DGM20 USB Microphone`. `npm run devices` lista os índices.

A captura de áudio usa `PvRecorder` (só a lib de áudio, **sem chave**). O detector de wake word é caseiro — não usa Picovoice.

## Transcrição na GPU (whisper.cpp + CUDA)

O caminho padrão (`@huggingface/transformers`) roda no CPU. Neste PC o DirectML na RTX 4060 alucinava, então a placa ficava de fora. Para usar a GPU **de verdade** — mais preciso e mais rápido — o Juarez sabe delegar para um binário do [whisper.cpp](https://github.com/ggml-org/whisper.cpp) compilado com **CUDA**.

O Node só grava o áudio num WAV temporário e chama o binário; a RTX transcreve e devolve o texto. Continua **100% local**.

1. Consiga um `whisper-cli.exe` com CUDA (build oficial com CUDA ou compilado com `-DGGML_CUDA=ON`).
2. Baixe um modelo GGML, ex.: `ggml-large-v3.bin`.
3. Aponte no `config.json`:

```json
"sttBackend": "whisper-cpp",
"whisperCppBinary": "C:\\tools\\whisper\\whisper-cli.exe",
"whisperCppModel": "C:\\tools\\whisper\\ggml-large-v3.bin",
"whisperCppLanguage": "pt",
"whisperCppExtraArgs": ["-t", "8"]
```

| Campo | Padrão | Função |
|---|---|---|
| `sttBackend` | `auto` | `auto` usa whisper.cpp se `binary`+`model` existirem, senão Whisper local; `whisper-cpp` força; `transformers` mantém só o CPU. |
| `whisperCppBinary` | `""` | Caminho do `whisper-cli.exe` (build CUDA). |
| `whisperCppModel` | `""` | Caminho do modelo GGML (`.bin`). |
| `whisperCppLanguage` | `pt` | Idioma passado no `-l`. |
| `whisperCppExtraArgs` | `[]` | Args extras repassados ao binário (threads, etc.). |

Se o binário/modelo sumir ou a transcrição vier incoerente, ele **cai sozinho** para o Whisper local — o Juarez nunca fica mudo. O modelo é carregado a cada frase (whisper.cpp abre e fecha por invocação), então o `large-v3` tem um custo de partida por pedido; vale pela precisão.

## Ele não é bobo

O Whisper, quando ouve silêncio, adora inventar coisa: *"Inscreva-se no canal"*, *"[Música]"*, um bloco em coreano, a mesma palavra vinte vezes. O `isHallucination` joga tudo isso no lixo antes de chegar no seu chat — script estrangeiro, loop de repetição, texto longo sem uma única palavra funcional do português.

## Os fantasmas da GPU

Sim, dá para rodar na RTX via DirectML (`"whisperDevice": "dml"`). Neste PC o turbo em fp16/q8 gerou tokens vazios e frases incoerentes, e o `whisper-medium` local estava truncado (`Protobuf parsing failed`). Por isso o padrão é CPU.

O código não desiste em silêncio: se a GPU falha no load, ou se a transcrição volta alucinada, ele recarrega sozinho no CPU com `whisper-small` e segue trabalhando.

## Quando o mordomo tropeça

**A cola caiu no editor em vez do chat** — deixe o painel do Agent aberto. Se o `Ctrl+I` está fechando o painel no seu setup, ponha `"openAgentHotkey": false`.

**Nada acontece** — Cursor e o terminal do listener **sem** "Executar como administrador". Processo elevado não aceita teclas de processo comum.

**"novo chat" abre no mesmo lugar** — o log tem que mostrar `new-chat: palette`. Reinicie com `npm start`.

**Ele não atende pelo nome** — rode `npm start`, fale, e olhe a linha `Ouvi: "..."`. Se o Whisper escreveu outra coisa, adote a grafia:

```json
"wakePhrases": ["juarez", "suarez", "joares"]
```

## Por dentro da copa

| Arquivo | Papel |
|---|---|
| `src/index.js` | O loop: espera fala, captura até o silêncio, transcreve, decide. |
| `src/audio.js` | RMS, limiar adaptativo do microfone, quando parar de gravar. |
| `src/stt.js` | Whisper via `@huggingface/transformers`, com queda para CPU. |
| `src/whisper-cpp.js` | Backend GPU: grava WAV, chama `whisper-cli` (CUDA), parseia o texto. |
| `src/transcript.js` | Normalização, wake word fuzzy/fonética, intenção de novo chat, caça-alucinação. |
| `src/listen-turn.js` | O árbitro: `arm`, `send`, `noise` ou `idle-ignore`. |
| `src/send-to-cursor.js` + `.ps1` | Clipboard, `Ctrl+I`, Command Palette, Enter. |
| `src/hud.js` + `.ps1` | A pílula azul (WinForms sempre no topo). |
| `src/tray.js` | O ícone na bandeja. |
| `src/gpu.js` | Lista GPUs do Windows e escolhe a NVIDIA. |
| `src/wav.js` | Decodifica, codifica e reamostra WAV para 16 kHz. |

Quer depurar sem falar? Jogue um WAV nele:

```powershell
node src/index.js --wav tmp\jarvis-ping.wav --dry-run
```

## Requisitos

Windows 10/11, Node 20+, Cursor aberto, um microfone e paciência com o Whisper.
