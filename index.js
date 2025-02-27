// run `node index.js` in the terminal

console.log(`Hello Node.js v${process.versions.node}!`);
const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  unit: { type: String, required: true }, // e.g., lbs, gallons
  image: { type: String }, // URL to product image
  lowStockThreshold: { type: Number, default: 10 }, // Default threshold for low stock
});

ProductSchema.methods.isLowStock = function () {
  return this.quantity <= this.lowStockThreshold;
};

module.exports = mongoose.model('Product', ProductSchema);
const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  status: { type: String, enum: ['Processing', 'Shipped', 'Delivered'], default: 'Processing' },
  deliveryETA: { type: Date },
  // Additional fields like items, total price, etc.
});

module.exports = mongoose.model('Order', OrderSchema);
const admin = require('firebase-admin');

// Function to send notifications to customers about order status
const sendOrderNotification = async (customerId, message) => {
  const customer = await Customer.findById(customerId);
  const token = customer.fcmToken;

  if (!token) return;

  const message = {
    notification: {
      title: 'Order Update',
      body: message,
    },
    token,
  };

  try {
    await admin.messaging().send(message);
    console.log('Notification sent');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};
const cron = require('node-cron');
const Product = require('./models/Product');
const nodemailer = require('nodemailer');

// Cron job to check low stock every hour
cron.schedule('0 * * * *', async () => {
  const products = await Product.find();
  
  products.forEach(async (product) => {
    if (product.isLowStock()) {
      sendLowStockNotification(product);
    }
  });
});

// Function to send low stock notifications to the farmer
const sendLowStockNotification = (product) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'your-email@gmail.com',
      pass: 'your-email-password',
    },
  });

  const mailOptions = {
    from: 'your-email@gmail.com',
    to: 'farmer-email@example.com', // Replace with actual farmer's email
    subject: `Low Stock Alert for ${product.name}`,
    text: `Your product "${product.name}" is low in stock. Only ${product.quantity} items left.`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Error sending email:', error);
    } else {
      console.log('Low stock notification sent:', info.response);
    }
  });
};import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, Button, TextInput, Alert } from 'react-native';
import axios from 'axios';

const InventoryScreen = ({ route }) => {
  const { farmerId } = route.params;
  const [products, setProducts] = useState([]);
  const [newProduct, setNewProduct] = useState({ name: '', price: '', quantity: '', unit: '' });

  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      const response = await axios.get(`https://your-api.com/inventory/${farmerId}`);
      setProducts(response.data);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  };

  const addProduct = async () => {
    try {
      await axios.post('https://your-api.com/inventory/add', { ...newProduct, farmerId });
      fetchInventory();
      setNewProduct({ name: '', price: '', quantity: '', unit: '' });
    } catch (error) {
      Alert.alert('Error', 'Could not add product');
    }
  };

  const deleteProduct = async (productId) => {
    try {
      await axios.delete(`https://your-api.com/inventory/delete/${productId}`);
      fetchInventory();
    } catch (error) {
      Alert.alert('Error', 'Could not delete product');
    }
  };

  return (
    <View>
      <Text>Inventory</Text>
      <FlatList
        data={products}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <View>
            <Text>{item.name} - {item.quantity} {item.unit}</Text>
            <Button title="Delete" onPress={() => deleteProduct(item._id)} />
          </View>
        )}
      />

      <TextInput placeholder="Name" value={newProduct.name} onChangeText={(text) => setNewProduct({ ...newProduct, name: text })} />
      <TextInput placeholder="Price" value={newProduct.price} keyboardType="numeric" onChangeText={(text) => setNewProduct({ ...newProduct, price: text })} />
      <TextInput placeholder="Quantity" value={newProduct.quantity} keyboardType="numeric" onChangeText={(text) => setNewProduct({ ...newProduct, quantity: text })} />
      <TextInput placeholder="Unit (lbs, gallons)" value={newProduct.unit} onChangeText={(text) => setNewProduct({ ...newProduct, unit: text })} />

      <Button title="Add Product" onPress={addProduct} />
    </View>
  );
};

export default InventoryScreen;import React, { useEffect } from 'react';
import { View, Text, Button } from 'react-native';
import axios from 'axios';
import messaging from '@react-native-firebase/messaging';

const ProductDetailScreen = ({ route }) => {
  const { productId } = route.params;
  const [product, setProduct] = useState(null);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await axios.get(`https://your-api.com/products/${productId}`);
        setProduct(response.data);
      } catch (error) {
        console.error('Error fetching product:', error);
      }
    };

    fetchProduct();
  }, []);

  const handleAddToCart = () => {
    if (product.quantity <= product.lowStockThreshold) {
      alert('This product is low in stock!');
    }
    // Proceed with adding to cart logic
  };

  return (
    <View>
      {product ? (
        <>
          <Text>{product.name}</Text>
          <Text>{product.price} USD</Text>
          <Text>Available: {product.quantity} {product.unit}</Text>
          {product.quantity <= product.lowStockThreshold && <Text style={{ color: 'red' }}>Low in Stock!</Text>}
          <Button title="Add to Cart" onPress={handleAddToCart} />
        </>
      ) : (
        <Text>Loading product details...</Text>
      )}
    </View>
  );
};

export default ProductDetailScreen;