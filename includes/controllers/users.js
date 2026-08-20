module.exports = function ({ models, api }) {
	const Users = models.use('Users');

	async function getInfo(id) {
		const sId = String(id);
		try {
			const data = await getData(sId);
			if (data && data.name && data.name !== "Người dùng facebook" && data.name !== "Người dùng") return data;
		} catch (_) {}

		try {
			const { execute } = require('../../modules/utils/database');
			const rows = await execute("SELECT name FROM messenger_users WHERE psid = ? AND name != 'Người dùng' AND name != '' LIMIT 1", [sId]);
			if (rows && rows[0] && rows[0].name) {
				return { id: sId, name: rows[0].name };
			}
		} catch (_) {}

		try {
			const ret = await api.getUserInfo(sId);
			return ret && ret[sId] ? ret[sId] : { id: sId, name: "Người dùng facebook" };
		} catch (_) {
			return { id: sId, name: "Người dùng facebook" };
		}
	}

	async function getNameUser(id) {
		const sId = String(id);
		try {
			if (global.data?.userName?.has(sId)) return global.data.userName.get(sId);
			if (global.data?.userName?.has(Number(sId))) return global.data.userName.get(Number(sId));

			const data = await getData(sId);
			if (data && data.name && data.name !== "Người dùng facebook" && data.name !== "Người dùng") {
				if (global.data?.userName) global.data.userName.set(sId, data.name);
				return data.name;
			}

			const { execute } = require('../../modules/utils/database');
			const rows = await execute("SELECT name FROM messenger_users WHERE psid = ? AND name != 'Người dùng' AND name != '' LIMIT 1", [sId]);
			if (rows && rows[0] && rows[0].name) {
				if (global.data?.userName) global.data.userName.set(sId, rows[0].name);
				return rows[0].name;
			}

			const ret = await api.getUserInfo(sId);
			if (ret && ret[sId] && ret[sId].name) {
				if (global.data?.userName) global.data.userName.set(sId, ret[sId].name);
				return ret[sId].name;
			}

			return "Người dùng facebook";
		}
		catch { return "Người dùng facebook"; }
	}

	async function getAll(...data) {
		var where, attributes;
		for (const i of data) {
			if (typeof i != 'object') throw global.getText("users", "needObjectOrArray");
			if (Array.isArray(i)) attributes = i;
			else where = i;
		}
		try {
			return (await Users.findAll({ where, attributes })).map(e => e.get({ plain: true }));
		}
		catch (error) {
			console.error(error);
			throw new Error(error);
		}
	}

	async function getData(userID) {
		try {
			const data = await Users.findOne({ where: { userID } });
			if (data) return data.get({ plain: true });
			else return false;
		}
		catch(error) {
			console.error(error);
			throw new Error(error);
		}
	}

	async function setData(userID, options = {}) {
		if (typeof options != 'object' && !Array.isArray(options)) throw global.getText("users", "needObject");
		try {
			(await Users.findOne({ where: { userID } })).update(options);
			return true;
		}
		catch (error) {
			try {
				await this.createData(userID, options);
			} catch (error) {
				console.error(error);
				throw new Error(error);
			}
		}
	}

	async function delData(userID) {
		try {
			(await Users.findOne({ where: { userID } })).destroy();
			return true;
		}
		catch (error) {
			console.error(error);
			throw new Error(error);
		}
	}

	async function createData(userID, defaults = {}) {
		if (typeof defaults != 'object' && !Array.isArray(defaults)) throw global.getText("users", "needObject");
		try {
			await Users.findOrCreate({ where: { userID }, defaults });
			return true;
		}
		catch (error) {
			console.error(error);
			throw new Error(error);
		}
	}

	return {
		getInfo,
		getNameUser,
		getAll,
		getData,
		setData,
		delData,
		createData
	};
};