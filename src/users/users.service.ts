import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateAccountInput } from './dtos/create-user.dto';
import { LoginInput, LoginOutput } from './dtos/login.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async createAccount({
    email,
    password,
    role,
  }: CreateAccountInput): Promise<{ ok: boolean; error?: string }> {
    try {
      // exist user
      const exist = await this.users.findOne({ email });
      if (exist) return { ok: false, error: 'exist user' };
      // create user
      await this.users.save(this.users.create({ email, password, role }));
      return { ok: true };
    } catch (e) {
      // return error message
      return { ok: false, error: "Couldn't create user" };
    }
  }

  async login({ email, password }: LoginInput): Promise<LoginOutput> {
    try {
      // find the user with the email
      const user = await this.users.findOne({ email });
      if (!user) return { ok: false, error: 'User not found' };

      // check if the password is correct
      const passwordCorrect = await user.chekcPassword(password);
      if (!passwordCorrect) return { ok: false, error: 'Wrong password' };

      // make a JWT and give it to the user

      // correct return
      return { ok: true, token: 'correct token' };
    } catch (error) {
      return { ok: false, error };
    }
  }
}
