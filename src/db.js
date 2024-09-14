import mongoose, { connect } from 'mongoose';

connect('mongodb+srv://Prabhdeep:prabhdeep1@cluster0.lbwiw.mongodb.net/trade_base?retryWrites=true&w=majority&appName=Cluster0', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Failed to connect to MongoDB', err));

  const { Schema, model } = mongoose;

  export { Schema, model };
  export default mongoose;
