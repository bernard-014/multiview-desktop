# Quadra — Multi-view 2×2

Página simples para assistir até **4 jogos ao mesmo tempo** na mesma aba do navegador, em grade 2×2, sem abrir quatro janelas com barra de título e URL.

## Como rodar

```bash
npm install
npm run dev
```

Abra [http://127.0.0.1:43123](http://127.0.0.1:43123).

Build de produção:

```bash
npm run build
npm run preview
```

## Uso

1. Cole até 4 URLs na tela inicial.
2. Clique em **Assistir**.
3. Passe o mouse no canto superior direito para **Editar links** ou **Tela cheia** (ou use **F11**).

Os links ficam salvos no `localStorage` do navegador.

## Limitações

Muitos sites de stream bloqueiam embed via iframe (`X-Frame-Options` / CSP). Nesses casos o painel fica em branco — isso é restrição do site, não do Quadra.
