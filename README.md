# Quadra — Multi-view

Quadra é um aplicativo desktop Electron para abrir de 1 a 16 páginas independentes em uma única janela. Cada painel usa uma `WebContentsView` completa do Chromium, portanto páginas que bloqueiam incorporação continuam podendo ser abertas diretamente no painel.

## Como rodar

```bash
npm install
npm run dev
```

Para gerar o build e o instalador Windows:

```bash
npm run build
npm run dist
```

O instalador é escrito em `release/`. Depois de instalado, o programa funciona sem Vite ou servidor local.

## Uso

1. Escolha qualquer quantidade entre 1 e 16 telas ou clique em **Começar com uma tela**.
2. Cole uma URL em cada painel e clique em **Abrir** ou **Abrir todos**.
3. Use **+ Adicionar tela** para montar a sessão gradualmente; o botão direciona o foco ao novo painel.
4. Use **Organizar** para destacar jogos, trocar posições e ajustar divisórias com o mouse ou as setas do teclado.
5. Escolha **Todos iguais**, **Organizar automaticamente**, **Desfazer** ou altere a quantidade no seletor **Telas**.
6. Use **Voltar**, **Tela Cheia**, o menu de opções e o botão de edição de cada painel.

O modo inicial distribui todos os painéis com a mesma área. Ao destacar um ou mais jogos, o Quadra monta uma composição automática com esses jogos em uma região maior; em 13 telas, um destaque recebe um quadrante e os outros 12 ficam em três quadrantes 2×2. O modo **Todos iguais** sempre remove os destaques. A composição manual mantém as proporções escolhidas ao redimensionar a janela.

As URLs ficam em memória durante a execução. Não há integração com navegadores externos, perfil separado ou configuração específica por serviço.

## Validações

```bash
npm test
npm run typecheck
npm run test:renderer
npm run test:app
npm run test:close
npm run test:packaged
```

Os testes locais cobrem cada quantidade de 1 a 16, adição progressiva de telas, preservação de rascunhos, áreas equivalentes, destaques múltiplos, o caso de 13 telas, divisórias por teclado, troca de posições, edição, ações coletivas, abertura de múltiplas páginas, fechamento e uma página com `X-Frame-Options` carregada diretamente em um painel.

Problemas de validação de URL, mensagens de erro de navegação, reabertura da mesma URL e perda de parâmetros em certos links do YouTube permanecem fora desta limpeza.
