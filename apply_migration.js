const database = require('./src/services/database');
const fs = require('fs').promises;

async function applyMigration() {
    try {
        console.log('🔄 Conectando a la base de datos...');
        await database.connect();

        console.log('📖 Leyendo archivo de migración...');
        const migrationSQL = await fs.readFile('./migrations/005_add_quoted_message_support.sql', 'utf8');

        // Separar las queries por punto y coma
        const queries = migrationSQL
            .split(';')
            .map(q => q.trim())
            .filter(q => q.length > 0 && !q.startsWith('--'));

        console.log(`📝 Ejecutando ${queries.length} queries de migración...\n`);

        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            if (query.toLowerCase().includes('show columns')) {
                console.log(`\n📊 Query ${i + 1}: Verificando columnas...`);
                const result = await database.query(query);
                console.log('Columnas en conversation_logs:');
                console.table(result);
            } else {
                console.log(`\n✅ Query ${i + 1}: ${query.substring(0, 50)}...`);
                await database.query(query);
                console.log('   Ejecutada exitosamente');
            }
        }

        console.log('\n✅ ¡Migración completada exitosamente!');

        await database.close();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error aplicando migración:', error.message);

        if (error.message.includes('Duplicate column')) {
            console.log('ℹ️  Las columnas de quoted message ya existen en la base de datos');
        }

        await database.close();
        process.exit(1);
    }
}

applyMigration();
