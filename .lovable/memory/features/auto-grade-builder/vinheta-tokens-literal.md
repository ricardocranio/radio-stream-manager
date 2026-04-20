---
name: Vinhetas como tokens literais (vht/VHTN)
description: O Lovable não resolve mais vinhetas; escreve `vht`/`VHTN` literais e a automação da rádio resolve em runtime.
type: feature
---
A partir da Entrega 2 do refresh real-time, o Lovable **não resolve mais** os tokens `vht` e `VHTN` ao escrever a grade no disco — eles permanecem literais nos arquivos `.txt`. A automação da rádio (RadioBoss/Zara/etc.) já reconhece esses tokens e escolhe a vinheta em runtime.

**Por quê:**
- Refresh real-time de slots P1 não corre risco de embaralhar a sequência de vinhetas (ela nunca foi resolvida pelo Lovable).
- Elimina dependência da pasta `C:\Playlist\Vinhetas` no Lovable.
- Elimina o scan BPM (economia de I/O e memória).
- Arquivos `.txt` ficam idempotentes (mesmo bloco gera o mesmo conteúdo).

**Implementação:** `src/lib/gradeBuilder/vinhetaResolver.ts` virou um stub no-op preservando a assinatura pública. Para reverter, restaure o arquivo via git.
