export const state = { perfil: null, recarregar: null, pendente: false };
export const papel = () => state.perfil?.papel;
export const ehAdmin = () => papel() === 'admin';
export const ehVendedor = () => papel() === 'vendedor';
export const ehCliente = () => papel() === 'cliente';
