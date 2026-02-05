FROM node:20-alpine

# Diretório de trabalho no container
WORKDIR /usr/src/app

# Copiar arquivos de dependência
COPY package*.json ./

# Instalar dependências
RUN npm install

# Copiar o restante do código fonte
COPY . .

# Expor a porta que o app usa
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["npm", "start"]
