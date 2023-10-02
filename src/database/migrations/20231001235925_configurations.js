export function up(knex) {
	return knex.schema.createTable('configurations', (table) => {
		table.increments('id').primary().notNullable();
		table.string('back_up_folder_path').notNullable();
		table.string('s3_access_key').nullable();
		table.string('s3_secret_key').nullable();
		table.string('s3_bucket_name').nullable();
		table.string('s3_region').nullable();
		table.timestamps();
	});
}

export function down(knex) {
	return knex.schema.dropTable('configurations');
}
