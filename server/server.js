const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

app.get('/api', (req, res) => {
  res.json({ 
    message: 'Elorm Borborbor API is running!',
    status: 'success'
  });
});

app.listen(PORT, () => {
  console.log('🚀 Server running on port 5000');
  console.log('📧 API: http://localhost:5000/api');
});
