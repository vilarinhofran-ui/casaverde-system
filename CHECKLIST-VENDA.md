# Checklist para vender e operar em producao

## Comercial e confianca

- Definir dominio oficial e SSL ativo.
- Publicar CNPJ, razao social e canais de atendimento reais.
- Revisar textos legais com apoio juridico (LGPD e CDC).

## Tecnico minimo

- Configurar backend com banco de dados real.
- Integrar pagamento real (Stripe/Mercado Pago) com webhook validado no servidor.
- Remover dados sensiveis do localStorage e usar sessao segura no backend.
- Habilitar logs de erro, monitoramento e backups.

## Operacao

- Definir SLA de atendimento e politica de troca com fluxo interno.
- Configurar notificacoes de pedido (e-mail/WhatsApp).
- Definir rotina de conciliacao fiscal e financeira.

## Marketing e conversao

- Vincular GA4, Search Console e Pixel de anuncios.
- Publicar sitemap e robots no dominio final.
- Criar campanhas para produtos de maior margem e recorrencia.

## Go-live

- Rodar testes em checkout completo (PIX, cartao, boleto).
- Testar PDV, ERP, fiscal e sincronizacao de estoque.
- Revisar performance em mobile (LCP, CLS, INP).
